# Releasing xtctx

## Forward path

Nothing is released by merging. One workflow does the whole thing, and only
when someone runs it.

1. Merge work to `main` and leave it there. There is no release PR to wait
   for and no version bump on merge.
2. When you actually want a release, dispatch the `release` workflow
   **against `main`**, choosing `patch`/`minor`/`major` and typing `release`
   to confirm. It refuses any other branch: a tag on an unreviewed commit
   would satisfy `publish`'s own tag check, which exists to prevent exactly
   that.
3. It runs `verify:release` *before* writing anything, bumps the version
   across every file that carries it (`npm version` triggers the `version`
   script, which syncs the plugin manifests, the marketplace entry and the
   landing site), writes the CHANGELOG entry from GitHub's generated notes,
   then commits, tags and creates the GitHub Release.
4. With `publish_npm` left on, it then starts the `publish` workflow as a
   separate run against the tag it just created: tag check,
   `verify:release`, then `npm publish --provenance` over OIDC trusted
   publishing — no long-lived token. A `post-publish-smoke` job installs the
   published version from the registry and runs `--help`/`--version` against
   it. Watch that run, not the release run: the release run finishes as soon
   as it has started the publish.

   A separate run, not a reusable-workflow call, because npm trusted
   publishing checks the workflow that started the run. The trusted
   publisher on npmjs.com is `publish.yml`; called from `release.yml`, npm
   would see `release.yml` and refuse, after the tag was already pushed. If
   the trusted publisher is ever changed, it must stay `publish.yml`.

To publish a version that was tagged earlier but never reached npm, dispatch
`publish` on its own against that tag, typing `publish` to confirm. That is
not hypothetical: this repo is in that state now, and has been since 0.19.0 —
fifteen tagged versions that npm has never served.

A release is **not done** until `post-publish-smoke` is green.

### Why this is manual

It used to be automatic, and the automation is what went wrong — twice.

Release Please opened a release PR on every conventional-commit merge and a
second workflow auto-merged it within seconds, so merging any change *was* a
release: four versions on 2026-08-28, two on 2026-08-27, five between 09:34
and 16:58 on 2026-08-30, none because anyone decided to release.

The first attempted fix drafted the release and left `publish` triggering on
`release: published`, so a draft published nothing. It worked, and it broke
the release process outright. GitHub's `releases/latest` endpoint hides
drafts, Release Please read it to find the last release, so it saw the last
pre-draft version forever, proposed a release covering the entire history,
auto-merge landed it, and the resulting draft was invisible again. That loop
cut 76 versions over four days, 49 of them on 2026-08-29 alone and 12 in its
busiest hour, before anyone noticed.

A per-day ceiling was tried after that and was the wrong shape: capping
unwanted releases still leaves them unwanted. The automatic path was removed
instead. Release Please, its config and the auto-merge workflow are all gone.

Do not add an event trigger to `.github/workflows/publish.yml` or
`release.yml`, and do not reintroduce Release Please.
`tests/release/release-gate.test.ts` fails on any of those.

## Rollback

npm does not allow republishing a yanked version, so rollback means pointing
users at a known-good version and marking the bad one:

```bash
npm deprecate xtctx@<bad-version> "Broken release, use <good-version> instead"
```

```bash
npm dist-tag add xtctx@<good-version> latest
```

Both commands require an npm account with publish access to `xtctx` (OIDC
covers CI publishes only). After rolling back, revert or fix forward on
`main`; the next release supersedes the deprecation.

If the bad release also wrote broken config via `setup`, users recover with
`npx -y xtctx@<good-version> setup --yes`, which rewrites every managed block,
skill copy and MCP entry. Do not tell anyone to delete `.xtctx/state` or to
run `--repair` on 0.19.0 or earlier: those versions delete the index there,
and the index is the only copy of sessions whose transcripts are gone (Claude
Code deletes them after 30 days by default).

## Post-release checklist

- [ ] `post-publish-smoke` job is green on the publish run
- [ ] `npx -y xtctx@latest --version` prints the new version
- [ ] `npm run demo:public` passes against this checkout (it imports the local
      `dist/`, not the published package)
- [ ] Landing site footer shows the new version (synced by the `version`
      script; see `landing/src/data/site.ts` and `scripts/sync-version.mjs`)

## Watching for upstream format drift

xtctx reads transcript files that seven other tools write, so the risk that
matters between releases is one of those tools changing its on-disk shape.
Three signals cover it, cheapest first:

**Nightly, free — `upstream-watch`.** Checks npm for releases of the tracked
tools against `.github/upstream-versions.json` and opens one issue when a
version moves. It never claims anything is broken; it marks the moment a
format *could* have changed, which is the only time checking is worth doing.
Deduped across all issue states, so a release is reported once.

**On demand, free — `npm run capture:formats`.** Fingerprints the real stores
on your machine and diffs them against `tests/drift/fingerprints/`. Records
field names and types only, never transcript content, so the output is safe to
commit. Run it after updating a tool and using it once:

```bash
npm run capture:formats            # report the diff
npm run capture:formats -- --write # accept the new shape
```

**On demand, costs API credit — the `drift-canary` workflow.** Runs the real
CLIs against real stores and asserts the scrapers still produce chunks. The
strongest signal and the only one that proves the scraper works end to end.
Dispatch it manually when `upstream-watch` fires; it is one short prompt per
tool. Without `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` configured it exits 78
and reports that it was skipped rather than filing a false drift issue.

After confirming a new version is fine, record it in
`.github/upstream-versions.json` so the watch stops reporting it.
