import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Publishing to npm is irreversible — a version cannot be unpublished, only
 * deprecated — so what triggers a release is a safety property, not a
 * convenience.
 *
 * Two shapes have failed here. First, `publish` fired on `release: published`
 * while release-please marked releases as drafts, so a draft published
 * nothing. That worked and broke the release process: GitHub's
 * `releases/latest` endpoint hides drafts, release-please read it to find the
 * last release, so it saw the last pre-draft version forever, proposed a
 * release covering the entire history, auto-merge landed it, and the resulting
 * draft was invisible again. Fifty-four versions in an hour.
 *
 * Second, with drafts gone, merging any `fix:`/`feat:` PR opened a release PR
 * that another workflow auto-merged within seconds — so merging a change was
 * itself a release. Five versions went out between 09:34 and 16:58 on
 * 2026-08-30, none of them awaited. A per-day ceiling was tried and was the
 * wrong shape; the automatic path was removed instead.
 *
 * What replaced both: one manual `release` workflow that cuts and publishes,
 * and `publish` reachable on its own for a version tagged earlier. These tests
 * assert that shape and, more importantly, the absence of any way back to an
 * automatic one.
 */

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");

/** Triggers that fire without a person deciding to. */
const AUTOMATIC_TRIGGERS = ["push", "pull_request", "pull_request_target", "release", "schedule", "repository_dispatch"];

async function readWorkflow(name: string): Promise<string> {
  // Normalized: a Windows checkout converts these to CRLF, and the
  // line-anchored parsing below silently matches nothing against it.
  return (await readFile(join(WORKFLOW_DIR, name), "utf-8")).replace(/\r\n/g, "\n");
}

function topLevelTriggers(workflow: string): string[] {
  const block = /\non:\n((?:[ \t]+.*\n|\n)*)/.exec(workflow)?.[1] ?? "";
  return block
    .split("\n")
    // Two-space indent identifies a trigger key; `#` excludes the comments
    // that sit at the same indent and would otherwise read as trigger names.
    .filter((line) => /^ {2}\S/.test(line) && !/^\s*#/.test(line))
    .map((line) => line.trim().replace(/:.*$/, ""));
}

describe("release gate", () => {
  it("publishes only when a person asks, directly or through the release workflow", async () => {
    const publish = await readWorkflow("publish.yml");
    const triggers = topLevelTriggers(publish);

    // Dispatch only. `release.yml` starts it with a dispatch too, never as a
    // reusable workflow: see the npm trusted publishing test below.
    expect(triggers).toEqual(["workflow_dispatch"]);
    for (const trigger of AUTOMATIC_TRIGGERS) {
      expect(triggers, `publish.yml must not run on ${trigger}`).not.toContain(trigger);
    }

    // And the dispatch itself is confirmed, not a bare button.
    expect(publish).toMatch(/confirm/);
  });

  it("cuts a release only on manual dispatch", async () => {
    const release = await readWorkflow("release.yml");

    expect(topLevelTriggers(release)).toEqual(["workflow_dispatch"]);
    expect(release).toMatch(/confirm/);
  });

  it("cuts a release only from main", async () => {
    // `workflow_dispatch` lets the operator pick any ref, and confirming the
    // word "release" was the only gate — so a release could be cut from a
    // branch, tagging a commit that never went through review on main. The
    // tag then satisfies `publish.yml`'s "is this commit tagged" check, which
    // exists to stop publishing an arbitrary branch tip and would have been
    // answered by the tag this very run had just created.
    const release = await readWorkflow("release.yml");

    expect(release).toMatch(/github\.ref[^\n]*refs\/heads\/main/);
  });

  it("publishes as its own run of publish.yml, against the tag it just pushed", async () => {
    // npm trusted publishing checks the workflow that started the run. Called
    // from release.yml as a reusable workflow, that is release.yml, not the
    // publish.yml every successful publish ran as, so the publish fails after
    // the tag is out. A dispatch keeps publish.yml the identity, and the tag
    // as the ref keeps its "is this commit tagged for its version" check
    // true: the pre-bump commit the caller started from would fail it.
    const release = await readWorkflow("release.yml");

    expect(release).not.toMatch(/uses:\s*\.\/\.github\/workflows\/publish\.ya?ml/);
    expect(release).not.toMatch(/id-token:\s*write/);
    expect(release).toMatch(/gh workflow run publish\.yml[^\n]*--ref "\$TAG"[^\n]*confirm=publish/);
    expect(release).toMatch(/actions:\s*write/);
  });

  it("has no workflow that creates a release or tag on an automatic trigger", async () => {
    // The broadest form of the guarantee: it does not matter what a future
    // workflow is called, only that nothing reaches `gh release create`,
    // `npm publish` or a tag push without someone starting it.
    const offenders: string[] = [];
    for (const file of await readdir(WORKFLOW_DIR)) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
      const workflow = await readWorkflow(file);
      const cuts =
        /gh release create/.test(workflow) ||
        /npm publish/.test(workflow) ||
        /git push .*(--tags|"?\$TAG)/.test(workflow);
      if (!cuts) continue;

      const triggers = topLevelTriggers(workflow);
      if (triggers.some((trigger) => AUTOMATIC_TRIGGERS.includes(trigger))) {
        offenders.push(`${file} (${triggers.join(", ")})`);
      }
    }

    expect(offenders, "workflows that release on an automatic trigger").toEqual([]);
  });

  it("documents the release process that exists", async () => {
    // The runbook described release-please, an `auto-merge-release-pr`
    // workflow and a `RELEASE_PLEASE_TOKEN` secret for a day after all three
    // were deleted, while README described the current process — so the two
    // contradicted each other and an operator following RELEASE.md waited for
    // a release PR that never comes. Asserting against the workflow directory
    // rather than a word list, so this fails whenever the docs name machinery
    // that is not there.
    const runbook = await readFile(join(process.cwd(), "RELEASE.md"), "utf-8");
    const workflows = (await readdir(WORKFLOW_DIR)).map((file) => file.replace(/\.ya?ml$/, ""));

    for (const named of runbook.matchAll(/`([a-z][a-z0-9-]*)\.ya?ml`|`([a-z][a-z0-9-]+)` workflow/g)) {
      const workflow = (named[1] ?? named[2]).replace(/\.ya?ml$/, "");
      expect(workflows, `RELEASE.md names a workflow that does not exist: ${workflow}`).toContain(
        workflow,
      );
    }

    expect(runbook).not.toMatch(/RELEASE_PLEASE_TOKEN/);
  });

  it("no longer carries the release-please config whose draft flag caused the loop", async () => {
    // Deleted with the automatic pipeline. Asserting its absence keeps the
    // 54-versions-in-an-hour failure from being reintroduced by restoring the
    // tooling without the reasoning.
    const entries = await readdir(process.cwd());
    expect(entries.filter((name) => name.startsWith(".release-please"))).toEqual([]);
  });
});

describe("workflows that run the release gate install what it needs", () => {
  // verify:release runs test:cloud and the landing build, each against its own
  // lockfile. release.yml installed only the root and landing, so the first
  // real release run failed typechecking the Worker, after CI had been green.
  it("installs root, landing and cloud dependencies before verify:release", async () => {
    const dir = join(process.cwd(), ".github", "workflows");
    const gated: string[] = [];
    for (const name of await readdir(dir)) {
      const text = await readFile(join(dir, name), "utf-8");
      const gate = text.indexOf("npm run verify:release");
      if (gate === -1) continue;
      gated.push(name);
      for (const install of ["npm ci", "npm --prefix landing ci", "npm --prefix cloud ci"]) {
        const at = text.indexOf(`run: ${install}`);
        expect(at, `${name} runs \`${install}\``).toBeGreaterThan(-1);
        expect(at, `${name} runs \`${install}\` before verify:release`).toBeLessThan(gate);
      }
    }
    expect(gated).toEqual(expect.arrayContaining(["release.yml", "publish.yml"]));
  });
});
