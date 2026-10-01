/**
 * The managed block records the MCP command so a human — or an agent reading
 * the file it is written into — can see how xtctx is wired. It is the one
 * place in the block that claims something runnable, and it was wrong.
 *
 * `portablePath` rewrites a path inside the project root to a `./`-relative
 * one, because the block lands in committed files (CLAUDE.md, AGENTS.md,
 * GEMINI.md) where an absolute path names a directory on exactly one machine.
 * But it ran over *every* argument, and `relative()` resolves a bare `-y`
 * against the process cwd. So whenever setup ran from inside the project it
 * was configuring — which is what `cd project && npx -y xtctx setup` does —
 * the flag came out as `./-y` and the block advertised `npx ./-y ./xtctx`.
 *
 * Two costs, and the second is the reason this is worth a test. The command
 * does not exist, so anyone who copies it gets an error. And the output
 * depends on cwd, so re-running setup from a different directory rewrites a
 * committed file — churn in a diff that has nothing to do with the change.
 */
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupProject } from "@xtctx/config/setup";
import { readXtctxPackage } from "@xtctx/utils/package-info";

describe("managed block command line", () => {
  let root = "";
  let home = "";
  let cwd = "";

  beforeEach(async () => {
    // Realpath both: on macOS the temp dir is a symlink, and comparing the
    // unresolved name against `process.cwd()` would make the cwd and the
    // project root differ by spelling alone — which is exactly the condition
    // that hid this bug from a naive test.
    root = await realpath(await mkdtemp(join(tmpdir(), "xtctx-cmd-")));
    home = await mkdtemp(join(tmpdir(), "xtctx-cmd-home-"));
    cwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  async function commandLine(): Promise<string> {
    const content = await readFile(join(root, "CLAUDE.md"), "utf-8");
    const match = /^- Command: `(.+)`$/m.exec(content);
    if (!match) throw new Error(`No command line in the managed block:\n${content}`);
    return match[1];
  }

  it("records a command that exists, when setup runs from inside the project", async () => {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app" }), "utf-8");
    process.chdir(root);

    await setupProject({ projectPath: root, homeDir: home, yes: true });

    expect(await commandLine()).toBe(`npx -y xtctx@${readXtctxPackage(import.meta.url).version}`);
  });

  it("records the same command regardless of where setup was run from", async () => {
    // The churn half. A committed file whose contents depend on the operator's
    // shell produces a diff on every run from a different directory.
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app" }), "utf-8");

    process.chdir(root);
    await setupProject({ projectPath: root, homeDir: home, yes: true });
    const fromInside = await commandLine();

    process.chdir(cwd);
    await setupProject({ projectPath: root, homeDir: home, yes: true });
    const fromOutside = await commandLine();

    expect(fromInside).toBe(fromOutside);
  });
});
