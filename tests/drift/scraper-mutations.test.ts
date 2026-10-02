/**
 * Scraper mutation-drift test suite — STRICT mode.
 *
 * For each of the five built-in scrapers we build a known-good fixture that
 * produces >= 1 chunk, then systematically mutate the fixture shape
 * (rename keys, null values, change types, drop fields, add unknown fields)
 * and run the scraper again.
 *
 * Strict assertion contract (enforced, not reported):
 *   - For every mutation marked `"loud-or-degraded"`, the scraper MUST do at
 *     least one of:
 *       1. throw,
 *       2. emit a `console.warn`/`console.error`, or
 *       3. produce output whose length differs from baseline (degraded).
 *     A silent-identical OR silent-empty return is an assertion FAILURE.
 *   - For every mutation marked `"silent-ok"` (explicit whitelist), the
 *     scraper MUST NOT throw AND MUST NOT warn AND MUST produce the same
 *     chunk count as baseline (forward-compat for new sibling fields).
 */

import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClaudeCodeScraper } from "@xtctx/scrapers/claude-code";
import { CodexCliScraper } from "@xtctx/scrapers/codex";
import { CopilotScraper } from "@xtctx/scrapers/copilot";
import { CopilotCliScraper } from "@xtctx/scrapers/copilot-cli";
import { CursorScraper } from "@xtctx/scrapers/cursor";
import { OpenCodeScraper } from "@xtctx/scrapers/opencode";
import type { ConversationChunk, ConversationScraper } from "@xtctx/types/scraper";

type Mutation =
  | { kind: "rename"; path: string; newKey: string }
  | { kind: "null"; path: string }
  | { kind: "retype"; path: string; to: "string" | "number" | "array" | "object" }
  | { kind: "drop"; path: string }
  | { kind: "unknown"; path: string; key: string };

interface MutationCase {
  name: string;
  mutation: Mutation;
  /**
   * If `"loud-or-degraded"` (default): scraper must either throw, warn, or
   * produce a different result than the baseline. A silent-identical return
   * is a gap.
   * If `"silent-ok"`: mutation is explicitly allowed to be tolerated silently
   * (e.g. adding unknown fields alongside — forward compat).
   */
  expectation?: "loud-or-degraded" | "silent-ok";
}

async function collect(scraper: ConversationScraper): Promise<{
  chunks: ConversationChunk[];
  threw: boolean;
  warned: boolean;
  warnings: string[];
  error?: string;
}> {
  const warnings: string[] = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...args) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  console.error = (...args) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };

  try {
    const chunks: ConversationChunk[] = [];
    for await (const chunk of scraper.fullSync()) {
      chunks.push(chunk);
    }
    return { chunks, threw: false, warned: warnings.length > 0, warnings };
  } catch (err) {
    return {
      chunks: [],
      threw: true,
      warned: warnings.length > 0,
      warnings,
      error: String(err),
    };
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
}

/** Apply a JSONPath-like mutation to an in-memory JSON object. */
function applyMutation(root: unknown, mutation: Mutation): unknown {
  const clone = JSON.parse(JSON.stringify(root)) as unknown;
  const segments = mutation.kind === "unknown" ? [mutation.path] : [mutation.path];
  const path = segments[0]!.split(".").filter(Boolean);

  if (mutation.kind === "unknown") {
    setAt(clone, path, (parent) => {
      if (parent && typeof parent === "object" && !Array.isArray(parent)) {
        (parent as Record<string, unknown>)[mutation.key] = "unknown-extra-value";
      }
    });
    return clone;
  }

  if (mutation.kind === "drop") {
    const leaf = path[path.length - 1]!;
    setAt(clone, path.slice(0, -1), (parent) => {
      if (parent && typeof parent === "object" && !Array.isArray(parent)) {
        delete (parent as Record<string, unknown>)[leaf];
      }
    });
    return clone;
  }

  if (mutation.kind === "rename") {
    const leaf = path[path.length - 1]!;
    setAt(clone, path.slice(0, -1), (parent) => {
      if (parent && typeof parent === "object" && !Array.isArray(parent)) {
        const record = parent as Record<string, unknown>;
        if (leaf in record) {
          record[mutation.newKey] = record[leaf];
          delete record[leaf];
        }
      }
    });
    return clone;
  }

  if (mutation.kind === "null") {
    const leaf = path[path.length - 1]!;
    setAt(clone, path.slice(0, -1), (parent) => {
      if (parent && typeof parent === "object" && !Array.isArray(parent)) {
        (parent as Record<string, unknown>)[leaf] = null;
      }
    });
    return clone;
  }

  if (mutation.kind === "retype") {
    const leaf = path[path.length - 1]!;
    setAt(clone, path.slice(0, -1), (parent) => {
      if (parent && typeof parent === "object" && !Array.isArray(parent)) {
        const record = parent as Record<string, unknown>;
        const cur = record[leaf];
        record[leaf] = retypeValue(cur, mutation.to);
      }
    });
    return clone;
  }

  return clone;
}

function setAt(root: unknown, path: string[], visit: (parent: unknown) => void): void {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return;
    }
  }
  visit(cur);
}

function retypeValue(
  cur: unknown,
  to: "string" | "number" | "array" | "object",
): unknown {
  switch (to) {
    case "string":
      return typeof cur === "string" ? cur + "-as-string" : String(cur);
    case "number":
      return 42;
    case "array":
      return Array.isArray(cur) ? ["mutated"] : [];
    case "object":
      return { mutated: true };
  }
}

function mutationLabel(m: Mutation): string {
  switch (m.kind) {
    case "rename":
      return `rename(${m.path} -> ${m.newKey})`;
    case "null":
      return `null(${m.path})`;
    case "retype":
      return `retype(${m.path} to ${m.to})`;
    case "drop":
      return `drop(${m.path})`;
    case "unknown":
      return `unknown-field(${m.path}.${m.key})`;
  }
}

/**
 * Runs a scraper against a good fixture (baseline) plus each mutation.
 * Reports gaps when a mutation yields silently-identical output.
 */
async function runScraperMutationBattery(
  label: string,
  setupBaseline: () => Promise<ConversationScraper>,
  setupMutation: (mutation: Mutation) => Promise<ConversationScraper | null>,
  cases: MutationCase[],
): Promise<void> {
  const baselineScraper = await setupBaseline();
  const baseline = await collect(baselineScraper);
  expect(baseline.threw, `${label} baseline must not throw`).toBe(false);
  expect(
    baseline.warned,
    `${label} baseline must not warn — any warn means the fixture itself triggers drift-detection: ${baseline.warnings.join(
      " | ",
    )}`,
  ).toBe(false);
  expect(baseline.chunks.length, `${label} baseline must produce >=1 chunk`).toBeGreaterThan(0);

  for (const mutationCase of cases) {
    const scraper = await setupMutation(mutationCase.mutation);
    if (!scraper) {
      // Mutation not applicable (e.g. path doesn't exist for this scraper).
      continue;
    }

    const result = await collect(scraper);
    const expectation = mutationCase.expectation ?? "loud-or-degraded";
    const label2 = `${label} :: ${mutationCase.name} [${mutationLabel(mutationCase.mutation)}]`;

    if (expectation === "silent-ok") {
      expect(
        result.threw,
        `${label2} must NOT throw on whitelisted forward-compat mutation (${result.error})`,
      ).toBe(false);
      expect(
        result.warned,
        `${label2} must NOT warn on whitelisted forward-compat mutation: ${result.warnings.join(" | ")}`,
      ).toBe(false);
      expect(
        result.chunks.length,
        `${label2} must emit the same chunk count as baseline (got ${result.chunks.length}, baseline ${baseline.chunks.length})`,
      ).toBe(baseline.chunks.length);
      continue;
    }

    // "loud-or-degraded": MUST throw, warn, OR produce a different chunk count.
    const degraded = result.chunks.length !== baseline.chunks.length;
    const loud = result.threw || result.warned;
    const pass = loud || degraded;

    expect(pass, `${label2} silently tolerated a destructive schema change — drift invisible in prod ` +
      `(chunks=${result.chunks.length}, baseline=${baseline.chunks.length}, threw=${result.threw}, warned=${result.warned})`).toBe(true);

    // An empty-return must be accompanied by a warn/throw — otherwise whole
    // sessions silently vanish upstream.
    if (result.chunks.length === 0 && baseline.chunks.length > 0) {
      expect(
        loud,
        `${label2} emitted ZERO chunks (baseline ${baseline.chunks.length}) without any warn/throw — ` +
          `this is the worst failure mode (silent data loss).`,
      ).toBe(true);
    }
  }
}

// ---- Scraper-specific setups ---------------------------------------------

function makeTempDirs() {
  return Promise.all([
    mkdtemp(join(tmpdir(), "xtctx-drift-")),
    mkdtemp(join(tmpdir(), "xtctx-state-")),
  ]);
}

async function cleanupTemp(dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
}

// Claude Code: JSONL per line.
//
// This shape is taken from tests/drift/fingerprints/claude-code.json, which is
// captured from a real store. It previously used `{type:"human", content}` —
// a type Claude Code does not emit, with content at a path it does not use —
// so every mutation below rewrote a field nothing reads, and the battery
// proved only that the scraper ignores a format it never sees.
const CLAUDE_BASELINE_LINES = [
  {
    type: "user",
    message: { role: "user", content: "help me" },
    timestamp: "2026-02-24T10:00:00Z",
  },
  {
    type: "assistant",
    message: { role: "assistant", content: "sure" },
    timestamp: "2026-02-24T10:00:05Z",
  },
];

// Codex: JSONL event stream.
const CODEX_BASELINE_LINES = [
  {
    timestamp: "2026-02-24T09:59:00Z",
    type: "session_meta",
    payload: { id: "codex-test-uuid" },
  },
  {
    timestamp: "2026-02-24T09:59:01Z",
    type: "turn_context",
    payload: { approval_policy: "suggest", sandbox_policy: { type: "workspace-write" } },
  },
  {
    timestamp: "2026-02-24T10:00:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "hello codex" },
  },
  {
    timestamp: "2026-02-24T10:00:05Z",
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "reply" }] },
  },
];

// Copilot: SQLite workspaceStorage.
const COPILOT_BASELINE_SESSIONS = {
  "0": {
    sessionId: "copilot-drift-session",
    creationDate: new Date("2026-02-24T10:00:00Z").getTime(),
    requests: [
      {
        message: { parts: [{ text: "q" }] },
        response: [{ value: "a" }],
        isCanceled: false,
        model: "gpt-4o-copilot",
      },
    ],
  },
};

// ---- Cursor setup (two SQLite DBs, shared layout) ------------------------

async function buildCursorFixture(
  rootDir: string,
  composerMutator?: (composer: Record<string, unknown>) => void,
  bubbleMutator?: (bubble: Record<string, unknown>) => void,
): Promise<string> {
  const workspaceDir = join(rootDir, "workspaceStorage", "hash1");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(join(rootDir, "globalStorage"), { recursive: true });

  const wsDb = new Database(join(workspaceDir, "state.vscdb"));
  wsDb.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  wsDb.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    "composer.composerData",
    JSON.stringify({ allComposers: [{ composerId: "c1" }] }),
  );
  wsDb.close();

  const composer: Record<string, unknown> = {
    composerId: "c1",
    fullConversationHeadersOnly: [
      { bubbleId: "b1", type: 1 },
      { bubbleId: "b2", type: 2 },
    ],
    createdAt: new Date("2026-02-24T10:00:00Z").getTime(),
    modelConfig: { modelName: "gpt-4.1" },
    unifiedMode: "agent",
  };
  if (composerMutator) composerMutator(composer);

  const bubble1: Record<string, unknown> = {
    type: 1,
    text: "cursor q",
    createdAt: "2026-02-24T10:00:00Z",
  };
  const bubble2: Record<string, unknown> = {
    type: 2,
    text: "cursor a",
    createdAt: "2026-02-24T10:00:05Z",
  };
  if (bubbleMutator) {
    bubbleMutator(bubble1);
    bubbleMutator(bubble2);
  }

  const globalDb = new Database(join(rootDir, "globalStorage", "state.vscdb"));
  globalDb.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  // Current Cursor has this table; a baseline without it would warn about its
  // absence and fail the battery's "baseline must not warn" check.
  globalDb.exec("CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT)");
  const ins = globalDb.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
  ins.run(`composerData:c1`, JSON.stringify(composer));
  ins.run(`bubbleId:c1:b1`, JSON.stringify(bubble1));
  ins.run(`bubbleId:c1:b2`, JSON.stringify(bubble2));
  globalDb.close();

  return workspaceDir;
}

// ---- Tests ---------------------------------------------------------------

describe("Scraper mutation drift", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    // no-op: strict mode — gaps now fail the test, not report.
  });

  afterEach(async () => {
    await cleanupTemp(tempDirs);
    tempDirs.length = 0;
  });

  it("claude-code: JSONL field mutations", async () => {
    const cases: MutationCase[] = [
      { name: "rename top-level type", mutation: { kind: "rename", path: "type", newKey: "typ" } },
      { name: "null content", mutation: { kind: "null", path: "content" } },
      { name: "retype timestamp to number", mutation: { kind: "retype", path: "timestamp", to: "number" } },
      { name: "drop timestamp", mutation: { kind: "drop", path: "timestamp" } },
      { name: "unknown field alongside", mutation: { kind: "unknown", path: "", key: "extraThing" }, expectation: "silent-ok" },
    ];

    await runScraperMutationBattery(
      "claude-code",
      async () => {
        const [tempDir, stateDir] = await makeTempDirs();
        tempDirs.push(tempDir, stateDir);
        const project = join(tempDir, "proj");
        await mkdir(project, { recursive: true });
        await writeFile(
          join(project, "s.jsonl"),
          CLAUDE_BASELINE_LINES.map((l) => JSON.stringify(l)).join("\n") + "\n",
        );
        return new ClaudeCodeScraper(tempDir, stateDir);
      },
      async (mutation) => {
        const [tempDir, stateDir] = await makeTempDirs();
        tempDirs.push(tempDir, stateDir);
        const project = join(tempDir, "proj");
        await mkdir(project, { recursive: true });
        const mutated = CLAUDE_BASELINE_LINES.map((l) => applyMutation(l, mutation));
        await writeFile(
          join(project, "s.jsonl"),
          mutated.map((l) => JSON.stringify(l)).join("\n") + "\n",
        );
        return new ClaudeCodeScraper(tempDir, stateDir);
      },
      cases,
    );
  });

  it("codex: event-stream mutations", async () => {
    const cases: MutationCase[] = [
      { name: "rename payload.type on event_msg", mutation: { kind: "rename", path: "payload.type", newKey: "tpe" } },
      { name: "null event type", mutation: { kind: "null", path: "type" } },
      { name: "retype payload.message to number", mutation: { kind: "retype", path: "payload.message", to: "number" } },
      { name: "drop payload.role on response_item", mutation: { kind: "drop", path: "payload.role" } },
      { name: "unknown top-level field", mutation: { kind: "unknown", path: "", key: "extraThing" }, expectation: "silent-ok" },
    ];

    await runScraperMutationBattery(
      "codex",
      async () => {
        const [tempDir, stateDir] = await makeTempDirs();
        tempDirs.push(tempDir, stateDir);
        await writeFile(
          join(tempDir, "s.jsonl"),
          CODEX_BASELINE_LINES.map((l) => JSON.stringify(l)).join("\n") + "\n",
        );
        return new CodexCliScraper(tempDir, stateDir);
      },
      async (mutation) => {
        const [tempDir, stateDir] = await makeTempDirs();
        tempDirs.push(tempDir, stateDir);
        // Apply mutation to every line where it's applicable.
        const mutated = CODEX_BASELINE_LINES.map((l) => applyMutation(l, mutation));
        await writeFile(
          join(tempDir, "s.jsonl"),
          mutated.map((l) => JSON.stringify(l)).join("\n") + "\n",
        );
        return new CodexCliScraper(tempDir, stateDir);
      },
      cases,
    );
  });

  it("copilot: interactive.sessions schema mutations", async () => {
    const cases: MutationCase[] = [
      { name: "rename requests -> queries", mutation: { kind: "rename", path: "requests", newKey: "queries" } },
      { name: "null creationDate", mutation: { kind: "null", path: "creationDate" } },
      { name: "retype requests to object", mutation: { kind: "retype", path: "requests", to: "object" } },
      { name: "drop sessionId", mutation: { kind: "drop", path: "sessionId" } },
      { name: "unknown field alongside", mutation: { kind: "unknown", path: "", key: "futureField" }, expectation: "silent-ok" },
    ];

    await runScraperMutationBattery(
      "copilot",
      async () => {
        const [tempDir, stateDir] = await makeTempDirs();
        tempDirs.push(tempDir, stateDir);
        const wsStorage = join(tempDir, "workspaceStorage");
        await mkdir(join(wsStorage, "hash1"), { recursive: true });
        const db = new Database(join(wsStorage, "hash1", "state.vscdb"));
        db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
        db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
          "interactive.sessions",
          JSON.stringify(COPILOT_BASELINE_SESSIONS),
        );
        db.close();
        return new CopilotScraper(wsStorage, stateDir);
      },
      async (mutation) => {
        const [tempDir, stateDir] = await makeTempDirs();
        tempDirs.push(tempDir, stateDir);
        const wsStorage = join(tempDir, "workspaceStorage");
        await mkdir(join(wsStorage, "hash1"), { recursive: true });
        const mutated = {
          "0": applyMutation(COPILOT_BASELINE_SESSIONS["0"], mutation),
        };
        const db = new Database(join(wsStorage, "hash1", "state.vscdb"));
        db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
        db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
          "interactive.sessions",
          JSON.stringify(mutated),
        );
        db.close();
        return new CopilotScraper(wsStorage, stateDir);
      },
      cases,
    );
  });

  it("cursor: composerData / bubble mutations", async () => {
    const cases: MutationCase[] = [
      {
        name: "rename fullConversationHeadersOnly",
        mutation: { kind: "rename", path: "fullConversationHeadersOnly", newKey: "bubbles" },
      },
      { name: "null modelConfig", mutation: { kind: "null", path: "modelConfig" } },
      {
        name: "drop fullConversationHeadersOnly",
        mutation: { kind: "drop", path: "fullConversationHeadersOnly" },
      },
      {
        name: "unknown field alongside",
        mutation: { kind: "unknown", path: "", key: "newField" },
        expectation: "silent-ok",
      },
    ];

    await runScraperMutationBattery(
      "cursor",
      async () => {
        const [rootDir, stateDir] = await makeTempDirs();
        tempDirs.push(rootDir, stateDir);
        const workspaceDir = await buildCursorFixture(rootDir);
        return new CursorScraper(workspaceDir, stateDir);
      },
      async (mutation) => {
        const [rootDir, stateDir] = await makeTempDirs();
        tempDirs.push(rootDir, stateDir);
        const workspaceDir = await buildCursorFixture(rootDir, (composer) => {
          const mutated = applyMutation(composer, mutation) as Record<string, unknown>;
          for (const key of Object.keys(composer)) delete composer[key];
          Object.assign(composer, mutated);
        });
        return new CursorScraper(workspaceDir, stateDir);
      },
      cases,
    );
  });

  it("opencode: message.data JSON mutations", async () => {
    const cases: MutationCase[] = [
      // Rename `role` so the scraper's role-extractor can't find it.
      { name: "rename role", mutation: { kind: "rename", path: "role", newKey: "rol" } },
      { name: "null role", mutation: { kind: "null", path: "role" } },
      { name: "drop role", mutation: { kind: "drop", path: "role" } },
      { name: "retype role to number", mutation: { kind: "retype", path: "role", to: "number" } },
      {
        name: "unknown field alongside",
        mutation: { kind: "unknown", path: "", key: "futureField" },
        expectation: "silent-ok",
      },
    ];

    interface OpenCodeFixture {
      role: string;
      sessionID: string;
      agent: string;
      time: { created: number };
    }

    const buildOpenCodeFixture = async (
      mutator?: (data: OpenCodeFixture) => OpenCodeFixture,
    ): Promise<{ scraper: OpenCodeScraper }> => {
      const [tempDir, stateDir] = await makeTempDirs();
      tempDirs.push(tempDir, stateDir);
      const dbPath = join(tempDir, "opencode.db");
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE session (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT,
          parent_id TEXT, slug TEXT NOT NULL, directory TEXT NOT NULL,
          path TEXT, title TEXT NOT NULL, version TEXT NOT NULL, share_url TEXT,
          time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
          time_compacting INTEGER, time_archived INTEGER
        );
        CREATE TABLE message (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
          time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
          data TEXT NOT NULL
        );
        CREATE TABLE part (
          id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
          session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
          data TEXT NOT NULL
        );
      `);
      const t0 = 1000;
      db.prepare(
        `INSERT INTO session VALUES ('s1', 'p1', NULL, NULL, 's', '/tmp', NULL, 't', '0.1', NULL, ?, ?, NULL, NULL)`,
      ).run(t0, t0);
      const baseData: OpenCodeFixture = {
        role: "user",
        sessionID: "s1",
        agent: "build",
        time: { created: t0 },
      };
      const data = mutator ? mutator(baseData) : baseData;
      db.prepare(`INSERT INTO message VALUES ('m1', 's1', ?, ?, ?)`).run(
        t0,
        t0,
        JSON.stringify(data),
      );
      db.prepare(`INSERT INTO part VALUES ('p1', 'm1', 's1', ?, ?)`).run(
        t0,
        JSON.stringify({ type: "text", text: "hello opencode" }),
      );
      db.close();
      return { scraper: new OpenCodeScraper(dbPath, stateDir) };
    };

    await runScraperMutationBattery(
      "opencode",
      async () => (await buildOpenCodeFixture()).scraper,
      async (mutation) => {
        const { scraper } = await buildOpenCodeFixture((data) => {
          return applyMutation(data, mutation) as OpenCodeFixture;
        });
        return scraper;
      },
      cases,
    );
  });

  it("copilot-cli: events.jsonl mutations", async () => {
    // Paths match the real record: the turn's text is at `data.content`, and
    // the speaker is carried by `type` (`user.message` / `assistant.message`)
    // rather than a `role` field. The previous list mutated `role` and a
    // top-level `content`, neither of which copilot-cli writes.
    const cases: MutationCase[] = [
      { name: "rename type", mutation: { kind: "rename", path: "type", newKey: "typ" } },
      {
        // `data.text` is a documented alternative the reader already accepts
        // (extractContent step 5), so this rename moves the turn between two
        // names it understands and loses nothing. Silence is correct here —
        // not a gap being papered over.
        name: "rename data.content to data.text",
        mutation: { kind: "rename", path: "data.content", newKey: "text" },
        expectation: "silent-ok",
      },
      { name: "null data.content", mutation: { kind: "null", path: "data.content" } },
      {
        name: "retype data.content to number",
        mutation: { kind: "retype", path: "data.content", to: "number" },
      },
      { name: "drop data", mutation: { kind: "drop", path: "data" } },
      {
        name: "unknown field alongside",
        mutation: { kind: "unknown", path: "", key: "newKey" },
        expectation: "silent-ok",
      },
    ];

    // From tests/drift/fingerprints/copilot-cli.json, captured from a real
    // store. It previously used `{type:"message", role, content}` — a type
    // copilot-cli does not emit, with content at a path it does not use.
    const COPILOT_CLI_BASELINE = {
      type: "user.message",
      id: "evt-1",
      timestamp: "2026-02-24T10:00:00Z",
      data: { content: "hello copilot cli" },
    };

    await runScraperMutationBattery(
      "copilot-cli",
      async () => {
        const [tempDir, stateDir] = await makeTempDirs();
        tempDirs.push(tempDir, stateDir);
        const sessionDir = join(tempDir, "sess-1");
        await mkdir(sessionDir, { recursive: true });
        await writeFile(
          join(sessionDir, "events.jsonl"),
          JSON.stringify(COPILOT_CLI_BASELINE) + "\n",
        );
        return new CopilotCliScraper(tempDir, stateDir);
      },
      async (mutation) => {
        const [tempDir, stateDir] = await makeTempDirs();
        tempDirs.push(tempDir, stateDir);
        const sessionDir = join(tempDir, "sess-1");
        await mkdir(sessionDir, { recursive: true });
        const mutated = applyMutation(COPILOT_CLI_BASELINE, mutation);
        await writeFile(
          join(sessionDir, "events.jsonl"),
          JSON.stringify(mutated) + "\n",
        );
        return new CopilotCliScraper(tempDir, stateDir);
      },
      cases,
    );
  });
});
