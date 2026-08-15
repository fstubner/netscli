# NetsCLI recovery handover

Last updated: 2026-08-11 (Europe/Dublin)

This file is intentionally untracked. Do not add it to a commit unless the user explicitly asks.

## Objective and incident summary

The user had completed a large NetsCLI update containing:

- a redesigned landing page;
- a new documentation site;
- a new changelog/release-notes page;
- a major desktop GUI redesign;
- related screenshots, content, CI checks, and release material.

Some changes were later discarded or partially restored. The partially restored website was accidentally deployed to `netscli.com`, so production was deliberately rolled back to the older pre-v0.3 site. The immediate recovery goal was to preserve every unrelated local change, reconstruct the complete website work on a clean branch, repair it, and verify it without deploying it.

## Current Git state

Current checked-out branch:

```text
site/recover-redesign
```

It is based on `origin/main` and is one local commit ahead. It has not been pushed.

Recovery commit:

```text
bf5dedabed09f4e25680718f6c249309f23b5292
Restore and harden site redesign
```

`origin/main` was at:

```text
3a008b9 Gate GitHub Pages deploy behind manual trigger only (#136)
```

The rollback immediately before that was:

```text
780211a Revert site/ to pre-v0.3.0 redesign state (roll back accidental deploy) (#135)
```

The last complete historical site snapshot used as the recovery source was commit `fbc1f09`. The pre-rollback history also includes `29e4696`; do not simply reset to it because the later manual deployment gate must remain intact.

Before starting the site recovery, the pre-existing dirty worktree was preserved on a separate branch:

```text
wip/fingerprint-scan-history
414e3281c1a0ed9c97a43763e04a278c188d7636
WIP: preserve fingerprint and scan history work
```

That WIP contains the fingerprint/scan-history work that had been present locally, including the new core database diff/fingerprint modules. Do not merge or cherry-pick it into the site recovery branch without reviewing its scope independently.

Expected status after this file is created:

```text
## site/recover-redesign...origin/main [ahead 1]
?? HANDOVER.md
```

No other tracked or untracked changes should be present.

## What the recovery commit contains

The recovery restored and repaired the complete site under `site/`, including:

- the redesigned landing page;
- Starlight documentation with 11 documentation pages;
- the release changelog, including the recovered v0.3.0 notes;
- custom documentation header/sidebar/footer components;
- desktop and TUI screenshots and optimized image variants;
- a custom 404 page, sitemap, metadata, and search indexing;
- landing-page installer selection, OS tabs, copy buttons, mobile navigation, and image lightboxes;
- site accessibility automation;
- the site CI workflow and repository file-size guard associated with this work.

Important repairs made after restoring the historical snapshot:

- Updated recovered DOM/event code to pass strict Astro/TypeScript checking.
- Fixed the landing page's inline module loading bug (`Cannot use import statement outside a module`) by letting Astro process the script and reading the repository value from a data attribute.
- Extracted image-lightbox code into `site/src/scripts/landing/lightbox.ts` so the repository size guard passes.
- Added accessible dialog/focus behavior for image previews.
- Fixed a responsive CSS regression that left the “Skip to content” link permanently visible on mobile.
- Replaced deprecated `navigator.platform` usage with user-agent/user-agent-data based detection.
- Upgraded the site to Astro `^7.2.0`, Starlight `^0.41.7`, `@astrojs/check` `^0.9.10`, and axe CLI `^4.12.1`.
- Regenerated `site/package-lock.json`; the resulting dependency audit is clean.
- Restored the accessibility CI command as a required check instead of the temporary `--if-present` bypass used while the site was rolled back.
- Normalized historical trailing whitespace so `git diff --cached --check` passes.

The desktop GUI redesign itself was already present on `main`; it was not reconstructed or modified as part of this site recovery.

## Deployment safety

Nothing was pushed, published, or deployed during this recovery.

`.github/workflows/pages.yml` is identical to `origin/main`. It remains gated behind a manual `workflow_dispatch` trigger. This was explicitly verified with:

```powershell
git diff origin/main -- .github/workflows/pages.yml
```

The command produced no diff.

Do not deploy merely because the site branch is now healthy. The next session should first review the branch with the user, then push/open a PR only if requested. Production should remain on the rolled-back site until the user explicitly approves an intentional deployment.

At the time of the initial assessment, production `netscli.com` was serving the older pre-v0.3 landing page, while `/docs/` and `/changelog/` were not live. Recheck production before making any current-state claim because that is external, mutable state.

## Verification already completed

All of these passed on the recovery branch after a clean `npm ci`:

```powershell
cd site
npm ci
npm audit
npm run check
npm run build
npm run test:a11y
cd ..
node scripts/check-file-size.mjs
git diff --cached --check
```

Recorded results:

- `npm audit`: 0 vulnerabilities.
- `npm run check`: 42 files, 0 errors, 0 warnings, 0 hints.
- `npm run build`: 14 static pages built successfully, with Pagefind and sitemap generation.
- `npm run test:a11y`: 7 routes tested with axe-core 4.12.1, 0 violations on every route.
- Repository file-size guard: passed.
- Git whitespace check: passed.

The accessibility routes were:

```text
/
/docs/
/docs/install/
/docs/interface-coverage/
/docs/desktop/
/changelog/
/404.html
```

Manual Playwright/browser QA also covered:

- desktop landing-page rendering;
- desktop documentation rendering;
- mobile landing page at 390 × 844;
- mobile navigation opening and layout;
- Windows/macOS/Linux installation tabs;
- the desktop-installer selector;
- image-preview dialog and Escape/focus behavior;
- changelog client-side rendering of real release data;
- docs and changelog navigation.

The only browser console errors observed in local production preview were Cloudflare Web Analytics requests blocked by localhost CORS. The earlier JavaScript module error was fixed and did not recur.

Temporary Playwright screenshots/snapshots and the temporary Astro preview server were removed/stopped after QA.

## Recommended next steps

1. Read this file and `AGENTS.md` before changing anything.
2. Confirm the current branch and status:

   ```powershell
   git status --short --branch
   git log -1 --oneline
   ```

3. Review the recovery relative to main:

   ```powershell
   git diff --stat origin/main...HEAD
   git diff origin/main...HEAD -- .github/workflows/site.yml site/package.json site/astro.config.mjs
   ```

4. Optionally run the site locally for the user's own review:

   ```powershell
   cd site
   npm run dev
   ```

5. If the user approves publication, push `site/recover-redesign` and open a PR. Do not deploy directly unless separately and explicitly requested.
6. Handle `wip/fingerprint-scan-history` as a separate workstream after the site recovery is reviewed. First inspect `414e328` rather than merging it wholesale.

## Useful files

- `site/src/pages/index.astro` — landing page assembly and processed client-script entry.
- `site/src/pages/changelog.astro` — changelog page.
- `site/src/content/docs/docs/` — restored documentation content.
- `site/src/scripts/landing-page.ts` — landing-page interactions.
- `site/src/scripts/landing/lightbox.ts` — accessible image-preview behavior.
- `site/src/scripts/changelog-page.ts` and `site/src/scripts/changelog/` — release rendering.
- `site/src/styles/global.css` — landing/global styling, including the repaired skip link.
- `site/src/styles/starlight/` — custom documentation styling.
- `site/scripts/a11y.mjs` — accessibility test runner.
- `.github/workflows/site.yml` — site build/check/accessibility CI.
- `.github/workflows/pages.yml` — manual-only production deployment workflow; intentionally unchanged.
- `scripts/check-file-size.mjs` — repository size guard restored with the site work.

## Environment notes

- Repository root: `H:\projects\private\needs-work\netscli`
- Shell: PowerShell on Windows.
- The site CI uses Node 22, which satisfies Astro 7's runtime requirement.
- This machine's PowerShell profile prints an unrelated `nvx` command-not-found warning after commands. It did not affect Git, npm, builds, or tests.
- Project instructions prohibit branch names containing `codex`; both recovery branches comply.

## Guardrails for the next session

- Preserve `HANDOVER.md` as untracked unless told otherwise.
- Do not reset, clean, or discard either recovery branch.
- Do not weaken network safety limits or mix GUI/site concerns into core networking code.
- Do not push, open a PR, or deploy without user authorization.
- Before any deployment, re-run the site checks and verify that `.github/workflows/pages.yml` is still manual-only.
