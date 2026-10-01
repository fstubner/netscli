import { describe, expect, it } from "vitest";
import { createToolHandlers } from "@xtctx/mcp/server";
import type {
  HandoffStatus,
  SessionMessage,
  SessionSearchMode,
  SessionService,
  SessionSummary,
} from "@xtctx/handoff/types";

class FixtureSessionService implements SessionService {
  async listRecentSessions(): Promise<SessionSummary[]> {
    return [
      {
        session_ref: "codex:session-a",
        tool: "codex",
        started_at: "2026-05-10T10:00:00.000Z",
        last_activity_at: "2026-05-10T10:01:00.000Z",
        message_count: 1,
        preview: "continue the setup refactor",
      },
    ];
  }

  async getSessionByRef(sessionRef: string): Promise<SessionSummary | null> {
    const sessions = await this.listRecentSessions();
    return sessions.find((session) => session.session_ref === sessionRef) ?? null;
  }

  async getSessionDetail(): Promise<SessionMessage[]> {
    return [
      {
        timestamp: "2026-05-10T10:01:00.000Z",
        role: "user",
        content: "continue the setup refactor",
      },
    ];
  }

  /**
   * What the handler actually asked for.
   *
   * This took no parameters and returned the recent list, so the query never
   * had to reach it: the JSON payload echoes the handler's own local variable,
   * and changing `sessions.ts` to pass `""` instead of the caller's query left
   * the test green. Recording the arguments is what makes the assertion about
   * the code rather than about the fixture.
   */
  lastSearch?: { query: string; limit: number; mode?: string };

  async searchSessions(
    query: string,
    limit: number,
    _toolFilter?: string[],
    mode?: SessionSearchMode,
  ): Promise<SessionSummary[]> {
    this.lastSearch = { query, limit, mode };
    return this.listRecentSessions();
  }

  async getStatus(): Promise<HandoffStatus> {
    return {
      project_root: "/repo",
      db_path: "/repo/.xtctx/state/xtctx.db",
      // Healthy embeddings: the real service reports a message here when the

      // model fails, and the status contract requires the field either way.
      embedding_error: null,
      redirected_tools: [],
      index_only_sessions: 0,
      last_scan_at: "2026-05-10T10:02:00.000Z",
      last_scan_ms: null,
      sessions: 1,
      messages: 1,
      retrieval_units: 1,
      vectorized_units: 1,
      vector_ms_per_unit: null,
    vector_segment_backlog: 0,
    vector_ms_per_segment: null,
      vector_model: "fixture-embedding",
      vector_device: null,
      semantic_search: "local",
      semantic_off_reason: null,
      tools: [
        {
          tool: "codex",
          detected: true,
          last_error: null,
          store_paths: ["/home/user/.codex/sessions"],
          indexed_sessions: 1,
          indexed_messages: 1,
          last_indexed_at: "2026-05-10T10:02:00.000Z",
        },
      ],
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

describe("handoff MCP integration", () => {
  /**
   * One assertion per tool. These were a single test covering all five, which
   * meant a break anywhere produced one red result whose name did not say
   * which contract had moved.
   */
  const handlers = () => createToolHandlers({ sessions: new FixtureSessionService() });

  it("lists recent sessions", async () => {
    await expect(handlers().get("xtctx_recent_sessions")?.({ format: "json" })).resolves.toMatchObject({
      sessions: [{ session_ref: "codex:session-a" }],
    });
  });

  it("returns a session's raw messages", async () => {
    await expect(
      handlers().get("xtctx_session_detail")?.({ session_ref: "codex:session-a", format: "json" }),
    ).resolves.toMatchObject({
      messages: [{ content: "continue the setup refactor" }],
    });
  });

  it("passes the caller's query through to the index", async () => {
    const service = new FixtureSessionService();
    const map = createToolHandlers({ sessions: service });

    await expect(
      map.get("xtctx_search_sessions")?.({ query: "setup", limit: 3, format: "json" }),
    ).resolves.toMatchObject({
      sessions: [{ session_ref: "codex:session-a" }],
    });

    expect(service.lastSearch?.query).toBe("setup");
    expect(service.lastSearch?.limit).toBe(3);
  });

  it("reports continuity status", async () => {
    await expect(handlers().get("xtctx_continuity_status")?.({ format: "json" })).resolves.toMatchObject({
      sessions: 1,
      messages: 1,
    });
  });

  it("builds a handoff manifest an orchestrator can act on", async () => {
    await expect(
      handlers().get("xtctx_handoff_manifest")?.({
        format: "json",
        correlation_id: "orchestrator:task-42",
        session_refs: ["codex:session-a"],
      }),
    ).resolves.toMatchObject({
      schema_version: "xtctx/handoff-manifest/v1",
      correlation_id: "orchestrator:task-42",
      sessions: [
        {
          handoff_id: "codex:session-a",
          retrieve: { tool: "xtctx_session_detail", arguments: { session_ref: "codex:session-a" } },
        },
      ],
      contract: { authority: "raw-transcript" },
    });
  });
});
