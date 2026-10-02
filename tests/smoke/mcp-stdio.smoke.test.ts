import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { SEEDERS, sandboxEnv } from "./helpers.js";

/**
 * Drives the real MCP server over stdio.
 *
 * `tests/integration/handoff-mcp.test.ts` calls the tool handlers directly
 * against a fake `SessionService` — useful, but it never starts a process,
 * never speaks JSON-RPC, and never touches SQLite. Nothing in the suite
 * exercised the transport, so the acceptance reviewer had to write its own
 * harness to check the thing users actually connect to.
 *
 * Run through `tsx` rather than `dist/`, because CI runs the smoke suite
 * before the build step.
 */
describe("MCP server over stdio", () => {
  let sandboxRoot = "";
  let projectRoot = "";
  const marker = "STDIO-SMOKE-MARKER decided the retry budget";
  let proc: ChildProcessWithoutNullStreams;
  let buffer = "";
  const pending = new Map<number, (message: Record<string, unknown>) => void>();

  function send(message: Record<string, unknown>): void {
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Retries while the answer is still the empty state: scans are bounded per call. */
  async function callUntilFound(
    startId: number,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    let text = "";
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = (await request(startId + attempt, "tools/call", { name, arguments: args })) as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
      };
      expect(response.result?.isError).not.toBe(true);
      text = response.result?.content?.[0]?.text ?? "";
      if (!text.includes("No matching sessions found")) return text;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
    }
    return text;
  }

  /**
   * What the spawned server wrote to stderr, and how it died if it died.
   *
   * Nothing read the child's stderr, so when the server failed to start the
   * suite reported only "initialize did not answer within 60s" — an assertion
   * about a symptom, with the cause piped into a buffer nobody drained. That
   * happened once under load on 2026-09-20 (four of five cases in this file),
   * could not be reproduced, and left nothing to diagnose.
   *
   * The likely cause is the one the comment below already names: the child
   * loads a ~100MB ONNX model, and this machine was running several model
   * loads at once. That is a guess, and it stays a guess precisely because
   * this text was thrown away. Now it is attached to the failure.
   */
  let childStderr = "";
  let childExit: string | null = null;

  function serverDiagnostics(): string {
    const tail = childStderr.trim().split("\n").slice(-20).join("\n");
    return [
      childExit ? `server process ${childExit}` : "server process still running",
      tail ? `stderr:\n${tail}` : "stderr: (empty)",
    ].join("\n");
  }

  function request(id: number, method: string, params: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(
        () => rejectPromise(new Error(`${method} did not answer within 60s\n${serverDiagnostics()}`)),
        60_000,
      );
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolvePromise(message);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  beforeAll(async () => {
    // realpath, because the product canonicalises its project root and the
    // seeded store has to agree with it.
    sandboxRoot = await realpath(await mkdtemp(join(tmpdir(), "xtctx-stdio-")));
    const home = join(sandboxRoot, "home");
    projectRoot = join(sandboxRoot, "project");
    await mkdir(home, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    // Seed one real transcript so the retrieval assertions mean something:
    // against an empty project every call answers "no matching sessions",
    // which would pass with indexing entirely broken.
    await SEEDERS["claude-code"](home, projectRoot, marker);

    // Without a project config no tool is enabled, so the server would index
    // nothing and the assertions would pass on an empty answer again.
    await mkdir(join(projectRoot, ".xtctx"), { recursive: true });
    await writeFile(
      join(projectRoot, ".xtctx", "config.yaml"),
      stringifyYaml({ tools: { "claude-code": { enabled: true } } }),
      "utf-8",
    );

    // The sandbox env, minus the flag that stops the CLI serving MCP — this
    // test exists to talk to that server.
    const env = { ...sandboxEnv(home) };
    delete env.XTCTX_NO_AUTO_MCP;
    // The rest of the suite runs with embeddings disabled, because several
    // vitest workers each loading a ~100MB ONNX model exhausted memory. This
    // file is the exception: one of its cases exists to prove the real model
    // loads inside a spawned server and vectorises, so it has to opt back in
    // for the child it spawns rather than inherit the suite's default.
    delete env.XTCTX_DISABLE_EMBEDDINGS;
    // The library is an add-on loaded from a runtime directory, and the sandbox
    // home has none. This repository has it as a devDependency, so the
    // repository root is one.
    env.XTCTX_EMBEDDING_RUNTIME_DIR = process.cwd();
    proc = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("src/cli/index.ts")], {
      cwd: projectRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    proc.stderr.on("data", (chunk) => {
      childStderr += String(chunk);
    });
    // Fail the pending call immediately rather than waiting out the timeout:
    // a server that has exited is never going to answer, and sixty seconds of
    // waiting adds nothing but sixty seconds.
    proc.on("exit", (code, signal) => {
      childExit = signal ? `killed by ${signal}` : `exited with code ${String(code)}`;
      for (const [id, resolvePending] of pending) {
        pending.delete(id);
        resolvePending({ error: { message: `server ${childExit}\n${serverDiagnostics()}` } });
      }
    });

    proc.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            const message = JSON.parse(line) as { id?: number };
            if (typeof message.id === "number") {
              pending.get(message.id)?.(message as Record<string, unknown>);
              pending.delete(message.id);
            }
          } catch {
            // Not a JSON-RPC line; the transport owns stdout, so ignore.
          }
        }
        newline = buffer.indexOf("\n");
      }
    });

    await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "stdio-smoke", version: "1" },
    });
  }, 120_000);

  afterAll(async () => {
    // Wait for the process to actually exit before deleting its project.
    // On Windows the server still holds the SQLite handle for a moment after
    // the kill, and the directory removal fails with EBUSY.
    if (proc && proc.exitCode === null) {
      const exited = new Promise<void>((resolvePromise) => proc.once("exit", () => resolvePromise()));
      proc.stdin.end();
      const force = setTimeout(() => proc.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(force);
    }
    await rm(sandboxRoot, { recursive: true, force: true });
  }, 30_000);

  it("advertises exactly the five read-only tools", async () => {
    const response = (await request(2, "tools/list", {})) as {
      result?: { tools?: Array<{ name: string }> };
    };

    const names = (response.result?.tools ?? []).map((tool) => tool.name).sort();
    expect(names).toEqual([
      "xtctx_continuity_status",
      "xtctx_handoff_manifest",
      "xtctx_recent_sessions",
      "xtctx_search_sessions",
      "xtctx_session_detail",
    ]);
  }, 60_000);

  it("answers a tool call with content, not an error", async () => {
    const text = await callUntilFound(100, "xtctx_recent_sessions", { limit: 2 });

    // The seeded session, retrieved end to end over the transport.
    expect(text).toContain("claude-code:");
  }, 120_000);

  it("returns the seeded transcript content through search", async () => {
    const text = await callUntilFound(200, "xtctx_search_sessions", {
      query: "STDIO-SMOKE-MARKER",
      mode: "keyword",
    });

    // Asserting on a real hit, not just "a response arrived": this is the one
    // test that proves indexing and retrieval work through the transport.
    expect(text).toContain("claude-code:");
  }, 120_000);

  it("survives a semantic search, which loads the embedding model in-process", async () => {
    // Issue #101: loading the model inside the *spawned* server aborted with a
    // native assertion on Linux and Windows runners, and the caller saw
    // `-32000: Connection closed` — the process gone mid-request rather than
    // an error returned. Every other test here uses `mode: "keyword"`, which
    // never loads the model, so CI was green while the path was untested.
    //
    // `vector` rather than `hybrid` on purpose: hybrid answers from keyword
    // while the model is still loading, so it can pass without ever finishing
    // the load that crashes.
    const response = (await request(6, "tools/call", {
      name: "xtctx_search_sessions",
      arguments: { query: "STDIO-SMOKE-MARKER", mode: "vector", limit: 5 },
    })) as { result?: { isError?: boolean } };
    expect(response.result).toBeDefined();

    // Returning is not the same as having loaded the model. Vectorizing is
    // budgeted, so the call answers on time whether or not the load finished,
    // and the first version of this test passed in 337ms on CI — far too fast
    // to have loaded anything, which would have made it green regardless of
    // whether the crash still happened.
    //
    // A vectorized window is proof the model loaded and ran in this process:
    // the count cannot rise without it.
    let vectorized = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const status = (await request(100 + attempt, "tools/call", {
        name: "xtctx_continuity_status",
        arguments: {},
      })) as { result?: { content?: Array<{ text?: string }> } };
      const text = status.result?.content?.[0]?.text ?? "";
      vectorized = Number(/Vectorized windows:\s*(\d+)/.exec(text)?.[1] ?? 0);
      if (vectorized > 0) break;
      // Nudge the backlog along; vectorizing happens inside a search.
      await request(200 + attempt, "tools/call", {
        name: "xtctx_search_sessions",
        arguments: { query: "STDIO-SMOKE-MARKER", mode: "vector", limit: 5 },
      });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
    }

    expect(vectorized, "windows vectorized in the spawned server").toBeGreaterThan(0);
    expect(proc.exitCode).toBeNull();
  }, 600_000);

  it("reports a bad argument as a caller error rather than crashing", async () => {
    const response = (await request(4, "tools/call", {
      name: "xtctx_search_sessions",
      arguments: { query: "" },
    })) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };

    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toMatch(/query/i);

    // Still alive and serving after a rejected call.
    const after = (await request(5, "tools/call", {
      name: "xtctx_continuity_status",
      arguments: {},
    })) as { result?: { isError?: boolean } };
    expect(after.result?.isError).not.toBe(true);
  }, 120_000);
});
