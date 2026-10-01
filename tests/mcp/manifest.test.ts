import { describe, expect, it } from "vitest";
import { createHandoffManifestHandler } from "@xtctx/mcp/tools/manifest";
import type {
  HandoffStatus,
  SessionMessage,
  SessionService,
  SessionSummary,
} from "@xtctx/handoff/types";

/**
 * A fixture service that honors `limit` the way the real index does — the
 * bug this file pins was invisible to fixtures that returned everything.
 */
class LimitHonoringService implements SessionService {
  constructor(private readonly sessions: SessionSummary[]) {}

  async listRecentSessions(limit: number): Promise<SessionSummary[]> {
    return [...this.sessions]
      .sort((left, right) => right.last_activity_at.localeCompare(left.last_activity_at))
      .slice(0, limit);
  }

  async getSessionByRef(sessionRef: string): Promise<SessionSummary | null> {
    return this.sessions.find((session) => session.session_ref === sessionRef) ?? null;
  }

  async getSessionDetail(): Promise<SessionMessage[]> {
    return [];
  }

  async searchSessions(): Promise<SessionSummary[]> {
    return [];
  }

  async getStatus(): Promise<HandoffStatus> {
    return {
      project_root: "/fixture",
      db_path: "/fixture/.xtctx/state/xtctx.db",
      // Healthy embeddings: the real service reports a message here when the

      // model fails, and the status contract requires the field either way.
      embedding_error: null,
      redirected_tools: [],
      index_only_sessions: 0,
      last_scan_at: "2026-05-10T10:00:00.000Z",
      last_scan_ms: null,
      sessions: this.sessions.length,
      messages: 0,
      retrieval_units: 0,
      vectorized_units: 0,
      vector_ms_per_unit: null,
    vector_segment_backlog: 0,
    vector_ms_per_segment: null,
      vector_model: "fixture",
      vector_device: null,
      semantic_search: "local",
      semantic_off_reason: null,
      tools: [],
    };
  }

  /** Nothing scans here, so there is never anything to wait for. */
  async whenScanSettled(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    return;
  }
}

function summary(ref: string, lastActivity: string): SessionSummary {
  return {
    session_ref: ref,
    tool: "codex",
    started_at: lastActivity,
    last_activity_at: lastActivity,
    message_count: 3,
  };
}

describe("xtctx_handoff_manifest", () => {
  it("resolves requested refs directly, even when they are not recent", async () => {
    const service = new LimitHonoringService([
      summary("codex:old-session", "2026-01-01T10:00:00.000Z"),
      summary("codex:mid-session", "2026-03-01T10:00:00.000Z"),
      summary("codex:new-session", "2026-05-01T10:00:00.000Z"),
    ]);
    const handler = createHandoffManifestHandler(service);

    const manifest = (await handler({ session_refs: ["codex:old-session"] })) as {
      sessions: Array<{ session_ref: string }>;
      missing_session_refs: string[];
    };

    expect(manifest.sessions.map((session) => session.session_ref)).toEqual([
      "codex:old-session",
    ]);
    expect(manifest.missing_session_refs).toEqual([]);
  });

  it("reports genuinely unknown refs as missing", async () => {
    const service = new LimitHonoringService([
      summary("codex:new-session", "2026-05-01T10:00:00.000Z"),
    ]);
    const handler = createHandoffManifestHandler(service);

    const manifest = (await handler({
      session_refs: ["codex:new-session", "codex:never-existed"],
    })) as {
      sessions: Array<{ session_ref: string }>;
      missing_session_refs: string[];
    };

    expect(manifest.sessions.map((session) => session.session_ref)).toEqual([
      "codex:new-session",
    ]);
    expect(manifest.missing_session_refs).toEqual(["codex:never-existed"]);
  });
});

/** Records what the handler actually asked the index for. */
class FilterRecordingService extends LimitHonoringService {
  lastToolFilter: string[] | undefined = undefined;
  lastBranchFilter: string[] | undefined = undefined;
  called = false;

  constructor() {
    super([]);
  }

  override async listRecentSessions(
    _limit: number,
    toolFilter?: string[],
    branchFilter?: string[],
  ): Promise<SessionSummary[]> {
    this.called = true;
    this.lastToolFilter = toolFilter;
    this.lastBranchFilter = branchFilter;
    return [];
  }
}

/**
 * The manifest takes the same filters as the session tools, and once carried
 * no validation for them at all.
 *
 * A bare `tool_filter: "codex"` — a string where an array belongs — normalized
 * to an empty list further down, and an empty list means *no filter*. So an
 * orchestrator asking for one tool's sessions was handed every tool's, with
 * nothing in the response to say the filter had been dropped. Widening is the
 * wrong direction to fail in: they asked for less and got more.
 *
 * `sessions.ts` already pins this for the session tools. It stayed green while
 * this handler passed the same bare string straight through, which is exactly
 * how the gap opened the first time.
 */
describe("manifest filter arguments that are not arrays of strings", () => {
  it.each([
    ["a bare string", "codex"],
    ["a number", 3],
    ["an object", { tool: "codex" }],
    ["an array holding a non-string", [{}]],
    ["an array holding an empty string", [""]],
  ])("rejects %s rather than returning every tool", async (_label, value) => {
    const service = new FilterRecordingService();
    const handler = createHandoffManifestHandler(service);

    await expect(handler({ tool_filter: value } as Record<string, unknown>)).rejects.toThrow(
      /tool_filter/,
    );
    // And it never reached the index to be quietly widened.
    expect(service.called).toBe(false);
  });

  it("rejects a bad branch_filter too", async () => {
    const service = new FilterRecordingService();

    await expect(
      createHandoffManifestHandler(service)({ branch_filter: "main" }),
    ).rejects.toThrow(/branch_filter/);
  });

  it("passes a valid filter through unchanged", async () => {
    const service = new FilterRecordingService();

    await createHandoffManifestHandler(service)({ tool_filter: ["codex"] });

    expect(service.lastToolFilter).toEqual(["codex"]);
  });

  it("passes a real branch name through, rather than checking it against tool ids", async () => {
    // The tool-id check was once written into the validator both filters
    // share, so `branch_filter: ["main"]` failed with "unknown tool id
    // \"main\"" and branch filtering was unreachable over MCP. The only
    // branch test above passed a bare string, which the array check rejects
    // for its own reason — so nothing noticed.
    const service = new FilterRecordingService();

    await createHandoffManifestHandler(service)({ branch_filter: ["main", "feat/x"] });

    expect(service.lastBranchFilter).toEqual(["main", "feat/x"]);
  });
});

/** Reports a scan still in flight, the way the real service does mid-index. */
class StillIndexingService extends LimitHonoringService {
  constructor() {
    super([summary("codex:only-one", "2026-05-01T10:00:00.000Z")]);
  }

  getIndexProgress() {
    return { scanning: true, vectorBacklog: 42, embeddingWarming: false, unreadTools: [] };
  }
}

/**
 * The manifest is the surface an external orchestrator reads instead of the
 * markdown one, so it has no prose note to fall back on: `freshness.indexing`
 * is the only thing that can tell it the session set is still filling.
 *
 * Reporting `null` there while a scan is running presents a partial index as
 * the whole history — the orchestrator concludes the sessions it did not get
 * do not exist, and stops asking. That is the failure mode this whole layer
 * exists to avoid, and it is invisible to a test that only counts sessions.
 */
describe("manifest freshness while the index is still filling", () => {
  it("reports indexing progress rather than claiming the set is complete", async () => {
    const manifest = (await createHandoffManifestHandler(new StillIndexingService())({})) as {
      freshness: { indexing: { scanning: boolean; vector_backlog: number } | null };
    };

    expect(manifest.freshness.indexing).not.toBeNull();
    expect(manifest.freshness.indexing?.scanning).toBe(true);
    expect(manifest.freshness.indexing?.vector_backlog).toBe(42);
  });

  it("still reports null when the service tracks no progress at all", async () => {
    const manifest = (await createHandoffManifestHandler(new LimitHonoringService([]))({})) as {
      freshness: { indexing: unknown };
    };

    expect(manifest.freshness.indexing).toBeNull();
  });
});
