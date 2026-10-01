import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * The release workflow writes the CHANGELOG entry with a shell step, and a
 * mistake in it ships: the file is committed and tagged by the same run. This
 * runs the step's real script against sample changelogs rather than a copy of
 * it, so what is tested is what the workflow will execute.
 *
 * It exists because the file now carries an `## [Unreleased]` section, and the
 * step used to insert above the first `## ` heading, which would have put the
 * new release above Unreleased and left that section describing shipped work.
 */

async function changelogStepScript(): Promise<string> {
  const workflow = (await readFile(join(process.cwd(), ".github", "workflows", "release.yml"), "utf-8"))
    .replace(/\r\n/g, "\n");
  const start = workflow.indexOf("      - name: Write the CHANGELOG entry");
  const runAt = workflow.indexOf("        run: |\n", start);
  const end = workflow.indexOf("\n      - name:", runAt);
  return workflow
    .slice(runAt + "        run: |\n".length, end)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

describe("release workflow: Write the CHANGELOG entry", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-changelog-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function release(changelog: string): Promise<string> {
    await writeFile(join(dir, "CHANGELOG.md"), changelog, "utf-8");
    await run("bash", ["-c", await changelogStepScript()], {
      cwd: dir,
      env: {
        ...process.env,
        NOTES: "### Bug Fixes\n\n* the notes",
        VERSION: "1.2.3",
        TAG: "xtctx-v1.2.3",
        GITHUB_REPOSITORY: "o/r",
      },
    });
    return (await readFile(join(dir, "CHANGELOG.md"), "utf-8")).replace(/\r\n/g, "\n");
  }

  const headings = (text: string): string[] =>
    text.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.replace(/\].*/, "]"));

  it("puts the release beneath Unreleased, empties Unreleased, and keeps older entries", async () => {
    const out = await release(
      "# Changelog\n\nintro\n\n## [Unreleased]\n\n* hand-written item\n\n## [1.0.0](u) (2026-01-01)\n\n* old\n",
    );

    expect(headings(out)).toEqual(["## [Unreleased]", "## [1.2.3]", "## [1.0.0]"]);
    expect(out).not.toContain("hand-written item");
    expect(out).toContain("* the notes");
    expect(out).toContain("* old");
    expect(out.startsWith("# Changelog\n\nintro\n\n## [Unreleased]\n\n## [1.2.3]")).toBe(true);
  });

  it("still inserts above the newest entry when there is no Unreleased section", async () => {
    const out = await release("# Changelog\n\nintro\n\n## [1.0.0](u) (2026-01-01)\n\n* old\n");

    expect(headings(out)).toEqual(["## [1.2.3]", "## [1.0.0]"]);
    expect(out.startsWith("# Changelog\n\nintro\n\n## [1.2.3]")).toBe(true);
  });
});
