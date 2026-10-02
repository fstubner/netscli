/**
 * A config that will not parse is not an empty project.
 *
 * `.xtctx/config.yaml` records which transcript stores the user allowed to be
 * read, so a file that cannot be parsed yields zero scrapers rather than
 * defaults — which is the right call, and it meant every MCP tool answered
 * "No matching sessions found." An agent reads that as "this project has no
 * cross-tool history" and tells the user so, while the real answer is "xtctx
 * is reading nothing at all until you fix one file".
 *
 * `xtctx status` has printed `UNREADABLE` for a while. Agents never run the
 * CLI, and the MCP surface is the only one they see.
 */
import { describe, expect, it } from "vitest";
import { createToolHandlers } from "@xtctx/mcp/server";

/** The prose, whether the notice came back as text or as a JSON payload. */
function prose(answer: unknown): string {
  return typeof answer === "string" ? answer : String((answer as { message?: unknown }).message);
}

const DETAILS = {
  projectRoot: "/repo",
  configPath: "/repo/.xtctx/config.yaml",
  message: "Flow sequence must end with a ] at line 2, column 1",
};

describe("an unreadable config over MCP", () => {
  it("answers every tool with the broken file rather than with nothing found", async () => {
    const handlers = createToolHandlers({ configError: DETAILS });

    expect(handlers.size).toBeGreaterThan(0);
    for (const [name, handler] of handlers) {
      const answer = prose(await handler({}));

      expect(answer, name).toContain(".xtctx/config.yaml");
      expect(answer, name).toContain("Flow sequence must end with a ]");
      expect(answer, name).not.toContain("No matching sessions found");
    }
  });

  it("says the history is unread rather than absent", async () => {
    const [, handler] = [...createToolHandlers({ configError: DETAILS })][0];

    const answer = prose(await handler({}));

    expect(answer).toMatch(/not an empty history/);
    expect(answer).toContain("Nothing has been changed.");
  });

  it("tells the agent not to edit the file unprompted", async () => {
    // It records which transcript stores the user allowed to be read, so an
    // agent "helpfully" rewriting it would be widening their own access.
    const [, handler] = [...createToolHandlers({ configError: DETAILS })][0];

    expect(prose(await handler({}))).toMatch(/Do not edit it unprompted/);
  });

  it("answers the manifest in JSON, which is what an orchestrator parses", async () => {
    // The manifest defaults to JSON and documents a versioned contract. These
    // notices used to be one prose string for every tool, so an orchestrator
    // calling it in a broken project got English it could not parse.
    const handler = createToolHandlers({ configError: DETAILS }).get("xtctx_handoff_manifest")!;

    const answer = (await handler({})) as Record<string, unknown>;

    expect(answer.status).toBe("config_unreadable");
    expect(answer.config_path).toBe("/repo/.xtctx/config.yaml");
    expect(String(answer.message)).toContain("Do not edit it unprompted");
  });

  it("answers any tool in JSON when asked for JSON", async () => {
    const handler = createToolHandlers({ unconfiguredProjectRoot: "/repo" }).get(
      "xtctx_recent_sessions",
    )!;

    const answer = (await handler({ format: "json" })) as Record<string, unknown>;

    expect(answer.status).toBe("not_configured");
    // With --yes: the agent runs it, in a shell setup will not prompt in, and
    // without the flag setup refuses there.
    expect(answer.setup_command).toBe("npx -y xtctx setup --yes");
    // And stays prose when not asked.
    expect(typeof (await handler({}))).toBe("string");
  });

  it("leaves the not-configured case alone, which means something different", async () => {
    // Nobody opted this directory in, against somebody did and the file broke.
    const handlers = createToolHandlers({ unconfiguredProjectRoot: "/repo" });
    const [, handler] = [...handlers][0];

    expect(prose(await handler({}))).toContain("not configured for xtctx");
    expect(prose(await handler({}))).toContain("npx -y xtctx setup --yes");
  });
});
