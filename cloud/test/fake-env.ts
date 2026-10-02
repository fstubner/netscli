import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SseSession } from "../src/sse-session.js";
import type { Env } from "../src/types.js";

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Every file in migrations/, in order, the way `wrangler d1 migrations apply` runs them. */
export function applyMigrations(db: DatabaseSync, upTo = Infinity): void {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files.slice(0, upTo)) db.exec(readFileSync(MIGRATIONS + file, "utf8"));
}

/**
 * Just enough of D1 over an in-memory SQLite for the Worker's own queries.
 * The real migrations are applied, so a column the code needs and the schema
 * lacks fails here the way it would in production.
 */
class FakeStatement {
  constructor(private db: DatabaseSync, readonly sql: string, readonly params: unknown[] = []) {}
  bind(...params: unknown[]) {
    return new FakeStatement(this.db, this.sql, params);
  }
  async first<T>() {
    return ((this.db.prepare(this.sql).get(...(this.params as never[])) as T | undefined) ?? null) as T | null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] };
  }
  async run() {
    this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true };
  }
}

export interface FakeD1Stats {
  batches: number[];
}

function fakeD1(db: DatabaseSync, stats: FakeD1Stats) {
  return {
    prepare: (sql: string) => new FakeStatement(db, sql),
    async batch(statements: FakeStatement[]) {
      stats.batches.push(statements.length);
      db.exec("BEGIN");
      try {
        for (const s of statements) await s.run();
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return statements.map(() => ({ success: true }));
    },
  };
}

/** KV in a Map: the calls workers-oauth-provider makes, with TTLs and metadata. */
export function fakeKV() {
  const store = new Map<string, { value: string; expiresAt?: number; metadata?: unknown }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };
  const decode = (value: string, type: unknown) => {
    const t = typeof type === "string" ? type : (type as { type?: string } | undefined)?.type;
    return t === "json" ? JSON.parse(value) : value;
  };
  return {
    store,
    async get(key: string, type?: unknown) {
      const entry = live(key);
      return entry ? decode(entry.value, type) : null;
    },
    async getWithMetadata(key: string, type?: unknown) {
      const entry = live(key);
      return { value: entry ? decode(entry.value, type) : null, metadata: entry?.metadata ?? null };
    },
    async put(key: string, value: string, options: { expirationTtl?: number; expiration?: number; metadata?: unknown } = {}) {
      const expiresAt = options.expirationTtl
        ? Date.now() + options.expirationTtl * 1000
        : options.expiration
          ? options.expiration * 1000
          : undefined;
      store.set(key, { value: String(value), expiresAt, metadata: options.metadata });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
      const keys = [...store.keys()].filter((k) => live(k) && k.startsWith(options.prefix ?? "")).sort();
      const start = options.cursor ? Number(options.cursor) : 0;
      const limit = options.limit ?? 1000;
      const page = keys.slice(start, start + limit);
      const done = start + limit >= keys.length;
      return {
        keys: page.map((name) => {
          const entry = store.get(name)!;
          return {
            name,
            metadata: entry.metadata,
            expiration: entry.expiresAt ? Math.floor(entry.expiresAt / 1000) : undefined,
          };
        }),
        list_complete: done,
        cursor: done ? undefined : String(start + limit),
      };
    },
  };
}

/** Durable Object namespace: one object per name, shared by everyone holding the namespace. */
function fakeNamespace() {
  const objects = new Map<string, SseSession>();
  return {
    idFromName: (name: string) => name,
    get: (id: string) => {
      if (!objects.has(id)) objects.set(id, new SseSession());
      return { fetch: (input: string, init?: RequestInit) => objects.get(id)!.fetch(new Request(input, init)) };
    },
  };
}

export const PUBLIC_URL = "https://mcp.test";

export function createEnv(overrides: Partial<Record<keyof Env, unknown>> = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applyMigrations(db);
  const stats: FakeD1Stats = { batches: [] };
  const kv = fakeKV();
  const env = {
    DB: fakeD1(db, stats),
    OAUTH_KV: kv,
    SSE: fakeNamespace(),
    PUBLIC_URL,
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    JWT_SECRET: "test-secret-for-the-worker-tests",
    ALLOWED_GITHUB_IDS: "1,2,3",
    ...overrides,
  } as unknown as Env;
  return { env, db, kv, stats };
}

/** What the runtime hands `fetch` as its third argument. */
export function fakeCtx(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
}
