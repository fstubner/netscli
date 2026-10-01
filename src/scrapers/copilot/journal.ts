import { describeType, isRecord } from "../base.js";
import { warnDrift } from "./shared.js";

/**
 * A journal record: 0 replaces the whole state, 1 sets a path, 2 pushes onto
 * an array (optionally truncating it first).
 */
const LOG_SNAPSHOT = 0;
const LOG_SET = 1;
const LOG_SPLICE = 2;

/**
 * Rebuild a session from a `.jsonl` chat log.
 *
 * The file is a journal, not a list of sessions: the first record is a full
 * snapshot and every record after it is one mutation — `k` is a key path, `v`
 * the value, and for kind 2 `i` is the length the array is cut back to before
 * `v` is pushed. Reading it as "one session per line" found only the
 * snapshot, whose `requests` array is empty because the turns arrive as later
 * mutations, so a whole conversation read as an empty session and said
 * nothing about it. One 182KB file on the machine this was written against
 * holds four turns across 35 records.
 *
 * `i` is NOT an insert position. VS Code's journal means "cut the array back
 * to length `i`, then push `v`", so a record names the request it rewrites and
 * drops everything after it. Applying it as an insert duplicated the first
 * question and hung later answers on the wrong requests, and a sort by
 * timestamp then papered over the misordering that caused. With the truncate
 * applied, array order is already conversation order.
 */
function replayChatSessionLog(raw: string, location: string): unknown {
  let state: Record<string, unknown> | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;

    let record: unknown;
    try {
      record = JSON.parse(line) as unknown;
    } catch (err) {
      warnDrift(location, `chat session line is not valid JSON: ${(err as Error).message}`);
      continue;
    }
    if (!isRecord(record)) continue;

    if (record.kind === LOG_SNAPSHOT) {
      state = isRecord(record.v) ? record.v : null;
      continue;
    }

    if (record.kind !== LOG_SET && record.kind !== LOG_SPLICE) {
      // Not skipped quietly: a mutation this reader does not know how to apply
      // leaves the rebuilt session wrong from that record on.
      warnDrift(
        location,
        `chat session journal has unknown record kind ${JSON.stringify(record.kind) ?? "undefined"}`,
      );
      continue;
    }

    // A mutation before any snapshot has nothing to apply to. Later records
    // are still tried, in case a snapshot appears further down.
    if (!state || !Array.isArray(record.k)) continue;
    const path = record.k as Array<string | number>;

    if (record.kind === LOG_SET) {
      setAtPath(state, path, record.v);
      continue;
    }

    const target = readAtPath(state, path);
    if (!Array.isArray(target)) continue;
    // `v` may be absent: a record can be a bare truncate.
    const values = record.v === undefined ? [] : record.v;
    if (!Array.isArray(values)) {
      warnDrift(
        location,
        `chat session journal push has a non-array value (got ${describeType(values)})`,
      );
      continue;
    }
    if (typeof record.i === "number") {
      if (Number.isInteger(record.i) && record.i >= 0 && record.i <= target.length) {
        target.length = record.i;
      } else {
        // Truncating at an index past the end would pad the array with holes.
        warnDrift(
          location,
          `chat session journal truncates at index ${record.i} of ${target.length}; appending instead`,
        );
      }
    }
    target.push(...values);
  }

  if (!state) {
    warnDrift(location, "chat session log has no snapshot record to rebuild from");
    return null;
  }

  return state;
}

/**
 * Key-path segments that reach the prototype chain instead of the object's own
 * data. The path comes out of the journal file, so it is attacker-controlled:
 * walking `__proto__` lands on `Object.prototype`, and writing there poisons
 * every object in the process.
 *
 * That is not a contained parsing bug. `better-sqlite3` reads its options with
 * `in`, which traverses the prototype chain, and turns a string `nativeBinding`
 * into a `require()` of that path — while the scrapers open databases with
 * `{readonly, fileMustExist}`, which owns neither key and so inherits both.
 *
 * `constructor` is currently unreachable by accident, because `readAtPath`
 * bails on a function, but it is listed rather than relied upon: the guard
 * should not depend on a `typeof` check elsewhere staying exactly as it is.
 */
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function hasUnsafeSegment(path: Array<string | number>): boolean {
  return path.some((key) => typeof key === "string" && UNSAFE_PATH_SEGMENTS.has(key));
}

function readAtPath(root: Record<string, unknown>, path: Array<string | number>): unknown {
  if (hasUnsafeSegment(path)) return undefined;
  let node: unknown = root;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

function setAtPath(
  root: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown,
): void {
  if (path.length === 0 || hasUnsafeSegment(path)) return;
  const parent = readAtPath(root, path.slice(0, -1));
  if (parent === null || typeof parent !== "object") return;
  (parent as Record<string | number, unknown>)[path[path.length - 1]] = value;
}

/**
 * Pull the session objects out of one `chatSessions/` file.
 *
 * `.json` holds a session directly. `.jsonl` is a journal and is replayed.
 *
 * A file that does not parse is worth a warning: it is named like a session and
 * sits where sessions live, so if it cannot be read something has changed.
 * @internal Exported for tests only.
 */
export function* parseChatSessionFile(
  raw: string,
  name: string,
  location: string,
): Iterable<unknown> {
  if (name.endsWith(".jsonl")) {
    const session = replayChatSessionLog(raw, location);
    if (session) yield session;
    return;
  }

  try {
    yield JSON.parse(raw) as unknown;
  } catch (err) {
    warnDrift(location, `chat session file is not valid JSON: ${(err as Error).message}`);
  }
}
