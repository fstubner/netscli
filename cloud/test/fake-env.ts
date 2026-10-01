import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SseSession } from "../src/sse-session.js";
import type { Env } from "../src/types.js";

/**
 * Just enough of D1 over an in-memory SQLite for the Worker's own queries.
 * The real schema.sql is loaded, so a column the code needs and the schema
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

function fakeD1(db: DatabaseSync) {
  return {
    prepare: (sql: string) => new FakeStatement(db, sql),
    async batch(statements: FakeStatement[]) {
      db.exec("BEGIN");
      try {
        for (const s of statements) await s.run();
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
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

export function createEnv(overrides: Partial<Record<keyof Env, unknown>> = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(fileURLToPath(new URL("../schema.sql", import.meta.url)), "utf8"));
  const env = {
    DB: fakeD1(db),
    SSE: fakeNamespace(),
    GITHUB_CLIENT_ID: "test-client",
    JWT_SECRET: "test-secret-for-the-worker-tests",
    ...overrides,
  } as unknown as Env;
  return { env, db };
}
