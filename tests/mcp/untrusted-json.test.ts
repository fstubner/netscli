/**
 * The markdown tools fence message bodies and say, above the fence, that they
 * are untrusted data. Asking for `format: "json"` skipped all of it: raw
 * transcript content came back in bare fields with nothing marking it as
 * data, so the same text an agent was warned about in one format arrived
 * unlabelled in the other.
 */
import { describe, expect, it } from "vitest";
import {
  createRecentSessionsHandler,
  createSearchSessionsHandler,
  createSessionDetailHandler,
  UNTRUSTED_NOTICE,
} from "@xtctx/mcp/tools/sessions";
import { createHandoffManifestHandler } from "@xtctx/mcp/tools/manifest";
import type { SessionService } from "@xtctx/handoff/types";

const service = {
  listRecentSessions: async () => [],
  searchSessions: async () => [],
  getSessionDetail: async () => [],
  getSessionByRef: async () => null,
  getStatus: async () => ({ project_root: "/fixture", last_scan_at: null, sessions: 0 }),
} as unknown as SessionService;

function expectLabelled(result: unknown): void {
  const payload = result as { untrusted?: boolean; notice?: string };
  expect(payload.untrusted).toBe(true);
  expect(payload.notice).toBe(UNTRUSTED_NOTICE);
  expect(UNTRUSTED_NOTICE).toMatch(/untrusted/i);
}

describe("JSON output marks transcript content as untrusted", () => {
  it("recent sessions", async () => {
    expectLabelled(await createRecentSessionsHandler(service)({ format: "json" }));
  });

  it("search", async () => {
    expectLabelled(await createSearchSessionsHandler(service)({ query: "x", format: "json" }));
  });

  it("session detail", async () => {
    expectLabelled(
      await createSessionDetailHandler(service)({ session_ref: "codex:a", format: "json" }),
    );
  });

  it("handoff manifest", async () => {
    expectLabelled(await createHandoffManifestHandler(service)({}));
  });

  it("rejects a from_end that is not a boolean", async () => {
    await expect(
      createSessionDetailHandler(service)({ session_ref: "codex:a", from_end: "yes" }),
    ).rejects.toThrow(/from_end must be a boolean/);
  });
});
