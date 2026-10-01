import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Database as DatabaseHandle } from "better-sqlite3";
import { getSetting } from "./schema.js";

/**
 * One scanner per project at a time, across processes.
 *
 * Every agent session starts its own xtctx server and every server scanned the
 * same stores into the same index, all at once. Measured with three servers
 * started together on a 10,000-message corpus: each read all of it, 3.8 to
 * 5.5 seconds of CPU apiece, to write the same rows three times.
 * Overlapping scans were also what lost rows permanently (see
 * `pruneRereadSessions`). With the lease, one server scans and the others serve
 * reads from the index while it fills.
 *
 * Held as a row in `settings`, taken inside `BEGIN IMMEDIATE`, so checking
 * that it is free and claiming it are one step for every process sharing the
 * file. A holder renews it while it works; a holder that stops renewing —
 * crashed, killed by its host, frozen — loses it at expiry, and one whose
 * process is gone from this machine loses it straight away.
 */
export const SCAN_LEASE_KEY = "scan_lease";

/**
 * When the last scan to finish began reading, in epoch milliseconds.
 *
 * What a server waiting on another's lease checks to decide whether it still
 * needs to scan: a scan that began after the waiter asked has read everything
 * the waiter would have.
 */
export const SCAN_COMPLETED_FROM_KEY = "scan_completed_from";

/** How long a lease lasts without renewal. */
export const SCAN_LEASE_TTL_MS = 30_000;

/** How often a holder renews. Well inside the TTL, so one late renewal costs nothing. */
export const SCAN_LEASE_RENEW_MS = 5_000;

interface LeaseRecord {
  token: string;
  pid: number;
  host: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface ScanLeaseOptions {
  now?: () => number;
  /** Whether a process on this machine is still running; see `processAlive`. */
  isAlive?: (pid: number) => boolean;
  ttlMs?: number;
}

export class ScanLease {
  /** Distinguishes two holders in one process, which tests are. */
  private readonly token = randomUUID();
  private readonly host = hostname();
  private readonly now: () => number;
  private readonly isAlive: (pid: number) => boolean;
  private readonly ttlMs: number;
  private acquiredAt: number | null = null;
  private renewedAt = 0;

  constructor(
    private readonly db: DatabaseHandle,
    options: ScanLeaseOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.isAlive = options.isAlive ?? processAlive;
    this.ttlMs = options.ttlMs ?? SCAN_LEASE_TTL_MS;
  }

  /** When this holder took the lease, or null when it does not hold it. */
  get heldSince(): number | null {
    return this.acquiredAt;
  }

  /**
   * Take the lease if nobody live holds it. False when someone does, and when
   * the database is too busy to say: a busy index is a reason to wait, not to
   * scan regardless.
   */
  tryAcquire(): boolean {
    try {
      return this.db
        .transaction(() => {
          const current = readLease(this.db);
          if (current && current.token !== this.token && !this.isStale(current)) {
            return false;
          }
          const now = this.now();
          this.write({ acquiredAt: now, expiresAt: now + this.ttlMs });
          this.acquiredAt = now;
          this.renewedAt = now;
          return true;
        })
        .immediate();
    } catch {
      return false;
    }
  }

  /**
   * Extend the lease if it is still this holder's. False means another
   * process took it over, and the caller should stop writing as a scanner.
   * Rate-limited to `SCAN_LEASE_RENEW_MS`, so it is cheap to call often.
   */
  renew(): boolean {
    if (this.acquiredAt === null) {
      return false;
    }
    const now = this.now();
    if (now - this.renewedAt < SCAN_LEASE_RENEW_MS) {
      return true;
    }
    try {
      const changed = this.db
        .prepare(
          `UPDATE settings SET value = ?
           WHERE key = ? AND json_extract(value, '$.token') = ?`,
        )
        .run(
          JSON.stringify(this.record(this.acquiredAt, now + this.ttlMs)),
          SCAN_LEASE_KEY,
          this.token,
        ).changes;
      if (changed === 0) {
        this.acquiredAt = null;
        return false;
      }
      this.renewedAt = now;
      return true;
    } catch {
      // Busy: the lease is still ours until it expires, and the next call
      // tries again.
      return true;
    }
  }

  /** Give the lease up, if this holder has it. */
  release(): void {
    if (this.acquiredAt === null) {
      return;
    }
    this.acquiredAt = null;
    try {
      this.db
        .prepare(`DELETE FROM settings WHERE key = ? AND json_extract(value, '$.token') = ?`)
        .run(SCAN_LEASE_KEY, this.token);
    } catch {
      // Left to expire.
    }
  }

  /** Whether a live holder other than this one has the lease right now. */
  heldElsewhere(): boolean {
    try {
      const current = readLease(this.db);
      return Boolean(current && current.token !== this.token && !this.isStale(current));
    } catch {
      return false;
    }
  }

  private isStale(lease: LeaseRecord): boolean {
    if (lease.expiresAt <= this.now()) {
      return true;
    }
    // Only a process on this machine can be checked. Another host's pid
    // means nothing here, so its lease stands until it expires.
    return lease.host === this.host && lease.pid !== process.pid && !this.isAlive(lease.pid);
  }

  private record(acquiredAt: number, expiresAt: number): LeaseRecord {
    return { token: this.token, pid: process.pid, host: this.host, acquiredAt, expiresAt };
  }

  private write({ acquiredAt, expiresAt }: { acquiredAt: number; expiresAt: number }): void {
    this.db
      .prepare(
        `INSERT INTO settings(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SCAN_LEASE_KEY, JSON.stringify(this.record(acquiredAt, expiresAt)));
  }
}

function readLease(db: DatabaseHandle): LeaseRecord | null {
  const raw = getSetting(db, SCAN_LEASE_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LeaseRecord>;
    if (
      typeof parsed.token === "string" &&
      typeof parsed.pid === "number" &&
      typeof parsed.host === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return parsed as LeaseRecord;
    }
  } catch {
    // Unreadable: treated as no lease, and overwritten by the next taker.
  }
  return null;
}

/**
 * Whether a pid names a running process on this machine.
 *
 * `kill(pid, 0)` sends nothing; it only asks. EPERM means the process exists
 * and belongs to someone else, which still counts as alive. A reused pid reads
 * as alive too, which costs at most one TTL of waiting.
 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** When the last completed scan began, or 0 if none has been recorded. */
export function lastCompletedScanFrom(db: DatabaseHandle): number {
  const value = Number(getSetting(db, SCAN_COMPLETED_FROM_KEY));
  return Number.isFinite(value) ? value : 0;
}
