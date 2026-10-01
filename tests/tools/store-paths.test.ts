import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultCursorStorePath, defaultOpenCodeStorePath } from "@xtctx/tools/sources";

/**
 * Default store paths are a guess about where another tool keeps its data, and
 * a wrong guess fails silently: the scraper finds nothing and the tool simply
 * reports zero sessions forever.
 *
 * opencode is the case that bit. On this Windows machine it writes to
 * `~/.local/share/opencode/opencode.db` — the XDG location — while the
 * platform-conventional guess was `%APPDATA%\opencode\opencode.db`. A real
 * store with 9 sessions was invisible to xtctx.
 */
describe("defaultOpenCodeStorePath", () => {
  let home = "";
  let saved: NodeJS.ProcessEnv;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "xtctx-storepath-"));
    saved = { ...process.env };
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    process.env.APPDATA = join(home, "AppData", "Roaming");
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(async () => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(home, { recursive: true, force: true });
  });

  async function createDb(...segments: string[]): Promise<string> {
    const path = join(home, ...segments);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "", "utf-8");
    return path;
  }

  it("finds a store at the XDG location when the conventional one is absent", async () => {
    const xdg = await createDb(".local", "share", "opencode", "opencode.db");

    expect(defaultOpenCodeStorePath()).toBe(xdg);
  });

  it("prefers the platform-conventional location when a store is there", async () => {
    const conventional =
      process.platform === "win32"
        ? await createDb("AppData", "Roaming", "opencode", "opencode.db")
        : process.platform === "linux"
          ? await createDb(".local", "share", "opencode", "opencode.db")
          : await createDb("Library", "Application Support", "opencode", "opencode.db");
    await createDb(".local", "share", "opencode", "opencode.db");

    expect(defaultOpenCodeStorePath()).toBe(conventional);
  });

  it("falls back to the conventional path when no store exists anywhere", () => {
    // Detection reports "not installed" either way; the path just has to be
    // the one a user would expect to see named in status output.
    const result = defaultOpenCodeStorePath();

    expect(result.endsWith("opencode.db")).toBe(true);
  });
});

/**
 * Cursor keeps its conversations under `User/workspaceStorage` of its
 * VS Code-style user directory. Without `APPDATA` the default used to be
 * `~/.cursor/workspaceStorage` on every platform, which is where Cursor keeps
 * extensions, not conversations — so on macOS and Linux a real install read as
 * having no sessions, and nothing said why.
 */
describe("defaultCursorStorePath", () => {
  const home = join("/", "home", "someone");
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    process.env.APPDATA = join(home, "AppData", "Roaming");
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it("uses Application Support on macOS", () => {
    delete process.env.APPDATA;

    expect(defaultCursorStorePath("darwin", home)).toBe(
      join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage"),
    );
  });

  it("uses ~/.config on Linux", () => {
    delete process.env.APPDATA;

    expect(defaultCursorStorePath("linux", home)).toBe(
      join(home, ".config", "Cursor", "User", "workspaceStorage"),
    );
  });

  it("uses APPDATA on Windows", () => {
    expect(defaultCursorStorePath("win32", home)).toBe(
      join(home, "AppData", "Roaming", "Cursor", "User", "workspaceStorage"),
    );
  });

  it("derives the Windows location from home when APPDATA is unset", () => {
    delete process.env.APPDATA;

    expect(defaultCursorStorePath("win32", home)).toBe(
      join(home, "AppData", "Roaming", "Cursor", "User", "workspaceStorage"),
    );
  });
});
