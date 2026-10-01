/**
 * Cloud requests close their connection. Without it the MCP server crashed on
 * exit on Windows (Node 24.14: `Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)`, exit 0xC0000409) after an upload tick followed by the
 * shutdown upload; see NO_KEEP_ALIVE in src/sync/client.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { callCloud } from "@xtctx/sync/client";

afterEach(() => vi.unstubAllGlobals());

describe("cloud requests", () => {
  it("ask the server to close the connection", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const creds = { token: "t", user: { id: "github:1", username: "u" }, deviceId: "d", deviceName: "n", syncUrl: "https://sync.test" };

    await callCloud(creds, "POST", "/api/stream", { sessions: [] });

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("connection")).toBe("close");
  });
});
