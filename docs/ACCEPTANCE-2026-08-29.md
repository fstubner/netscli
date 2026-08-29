# Acceptance pass — 2026-08-29

Audited commit: `448ee89` (main, clean tree).
Acceptor: Claude, **in the builder context** — this same session wrote every
fix under `[Unreleased]`. Independence caps are ON and the verdict cannot
reach SHIP. See "What this verdict does not cover".

Written to disk because the previous pass's findings existed only in
conversation history and were lost to compaction. Re-run this file, do not
reconstruct it from memory.

---

## Verdict: CONDITIONAL

The pass opened at `BLOCK` on one failing check (F-1), which was cleared by
rewording the walkthrough. `CONDITIONAL` is the ceiling this run can reach:
the independence and runtime caps are on and cannot be lifted from inside the
session that wrote the code.

```
A-independent        not_evaluated   ran in builder context
A-runtime            not_evaluated   runtime not independently verified
A-runtime-replay     pass            no replay block declared
A-intent-anchored    not_evaluated   PRODUCT.md provenance "undeclared"
A-product-contract   pass
A-design-direction   pass
A-ux-walkthrough     pass
D-frontend           not_evaluated   CONDITIONAL (open: F-dual-framework)
D-smoke-report       pass            release-engineering SHIP
```

Verdict history this pass: `BLOCK` → `CONDITIONAL` after F-1.

---

## Findings

### F-1 — `F-walkthrough-observable` failed; mostly a line-wrapping artifact — FIXED

**Severity: Medium** (blocked the gate; low product risk)

The frontend checker reports 5 of 7 walkthrough steps have "no observable
outcome". Two separate causes, and neither is a product defect:

1. **The checker tests one line per step.** It filters lines matching
   `^\d+[.)]\s+\S` and tests each in isolation, so a hard-wrapped step is
   judged on its first line only. Step 4's observable outcome — "The detail
   pane below **shows** the selected row's fields" — sits on line 3 and is
   never seen.
2. **Vocabulary.** Joining continuation lines drops the silent count from 5
   to 2. The two survivors (steps 1 and 5) do state outcomes — "the window
   opens on a Discover tab", "a long sweep in one does not block another" —
   in words the regex has no entry for (`opens`, `does not block`).

**Evidence.** Measured against the checker's own extraction and regex:

| version | steps | silent (first line only) | silent (whole step) |
|---|---|---|---|
| `32c04c7` (session start) | 7 | 5 | — |
| `HEAD` (`448ee89`) | 7 | 5 | 2 |

**Pre-existing, not introduced today.** The count is identical before and
after this session's walkthrough edits.

**Fixed** in this pass. Five first lines needed the reword, not two — steps
1, 2, 4, 5 and 7 — because the checker judges each numbered line in
isolation. Each now states its outcome on the step's own line:

| step | outcome now on line 1 |
|---|---|
| 1 | the window **shows** a Discover tab |
| 2 | the run button **reads** "Discover" |
| 4 | the detail pane **shows** that row's fields |
| 5 | the follow-up tab **appears** at the end of the strip |
| 7 | the exported file **appears** on disk |

Substance unchanged; no code touched. Step 5's claim was verified against
`useTabLifecycle.ts:55` before being written — `openHostTool` does set
`tab.form.host` and activate the new tab.

Step 7 needed a second edit: the first attempt said copying rows and saving a
bundle "behave the same way" as an export, which is wrong — a copy goes to
the clipboard, not to disk. It now says the three exits are equally quiet on
success, which is true of all of them.

`F-walkthrough-observable` now passes: "7 step(s), each naming an observable
outcome". The check is not vacuous — it rejected two intermediate drafts that
put the outcome on a continuation line.

---

### F-2 — Code-smells checker BLOCKs on untracked local directories

**Severity: Low** (false positive; no product impact)

`check-smells` returns BLOCK. Every cited file is in `.archive/` or
`.preview-recovered/`:

```
S-large-file    .archive/src/TUI.tsx (699 lines), .archive/src/index.tsx (510),
                .preview-recovered/site/src/scripts/changelog-page.ts (737), +3
S-deep-nesting  depth 11 at .archive/src/mcp/server-simple.ts:48
```

Both directories are **gitignored and untracked** (`git ls-files` returns 0
for each; `.gitignore:11` and `.gitignore:74`). They are local scratch, not
shipped code, and the repo's own `check-file-size.mjs` passes.

**Fix:** none needed in the product. If this checker is ever wired into CI,
it must respect `.gitignore` first or it will block on files that do not exist
in the repository.

---

### F-3 — The e2e render suite could not be run for this pass

**Severity: High** (coverage gap, not a defect)

`npm run test:tauri-render` fails before starting:

```
failed to run 'cargo metadata' ... program not found
```

The suite builds the app inside an nvx AppContainer sandbox that does not
inherit the caller's PATH. Root cause is F-4.

This matters more than it looks: **the Stop/cancel scenario added today has
not been executed in this pass.** It is the newest test, covering the code
path that was completely broken until `cb0e791`, and CI cannot run it either
— see F-5.

---

### F-4 — Rust toolchain is not reachable by its conventional path

**Severity: High** (environment; silently selects the wrong compiler)

`rustup.exe` is not installed on this machine, and `~/.cargo/bin` contains
only `tauri-driver.exe` — no `cargo.exe`, no `rustc.exe`. The toolchains
exist at `~/.rustup/toolchains/`, but nothing routes to them.

Two consequences, both observed today:

1. **Anything not inheriting a hand-built PATH fails outright** — the e2e
   sandbox (F-3), and `tauri dev` on first invocation.
2. **`rust-toolchain.toml` is not honoured.** The repo pins `1.96.0`.
   Putting a toolchain's `bin` directly on PATH bypasses the rustup shim that
   reads that pin. Doing so selected `1.98.0` and hit an **internal compiler
   error** in `phf_generator 0.13.1`:
   ```
   error: internal compiler error: no type-dependent def for method call
     --> phf_generator-0.13.1/src/lib.rs:32:5
   note: rustc 1.98.0 (88d9e12ae 2026-08-18)
   ```
   The pinned 1.96.0 builds the same tree in 50s. The pin is doing real work
   and the machine has no way to apply it automatically.

**Fix:** install `rustup` so `~/.cargo/bin/cargo.exe` exists and the pin is
honoured by default. Until then every Rust invocation here needs
`~/.rustup/toolchains/1.96.0-x86_64-pc-windows-msvc/bin` prepended manually,
and getting that wrong picks a compiler that cannot build the tree.

---

### F-5 — `GUI Render` has not produced a passing run

**Severity: Medium** (known and documented; recorded so it is not forgotten)

Last five runs: `cancelled, cancelled, failure, failure, failure`. Most
recent run 2026-08-25 — it has **not run against any of today's work**.

This is deliberate and well documented in the workflow header: the PR trigger
was removed because hosted Windows runners are elevated, so
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is ignored and the app never opens
its debug port. It is scheduled weekly plus manual dispatch.

The consequence is the honest part: combined with F-3, **the GUI e2e suite
has no passing signal anywhere right now** — not locally, not in CI. Every
GUI behaviour in this release rests on unit tests and manual observation.

---

## What passed

| Suite | Result |
|---|---|
| Rust workspace tests | **199 passed, 0 failed** (12 binaries) |
| GUI unit tests (vitest) | **191 passed, 0 failed** (34 files) |
| `design-tokens.mjs` | 124 contrast pairs ≥ 4.5:1 across 2 surfaces |
| `check-app-doc-links.mjs` | 1 netscli.com link, built by the site |
| `check-file-size.mjs` | pass |
| `check-organization` | SHIP — 258 files, no circular imports |
| `check-backend` | SHIP — no server; gate not required |

**Docs site, driven live** at `localhost:4322`. All 13 routes return 200
with a correct `<h1>`, and `/does-not-exist/` correctly 404s with "Page not
found". Nav renders `Features · Install · FAQ · Docs · Changelog · GitHub`
from the single source in `site/src/data/site-content/nav.ts`.

---

## Open, not defects

- **The docs are not deployed.** Live netscli.com nav is
  `Features · Install · FAQ · GitHub` — no Docs, no Changelog. It is a
  pre-docs deploy. `/docs/` 404s in the world while the desktop app's "Open
  setup docs" button points there. `pages.yml` is manual-trigger by design,
  awaiting approval to ship the redesign.
- **12 fixes unreleased** against tag `v0.3.0`.

---

## What this verdict does not cover

- **Independence.** This session wrote the code. `A-independent` is
  `not_evaluated` and SHIP is unreachable until a fresh session audits it.
- **Intent.** `PRODUCT.md` declares no provenance, so `A-intent-anchored` is
  `not_evaluated`. This verdict covers consistency and build quality — not
  whether this is the right product. Lifting it needs a sentence from the
  person who wanted the thing, not a better document.
- **Runtime.** `A-runtime` is `not_evaluated`. I launched the app and
  confirmed the process is live and the binary current (rebuilt 19:40, zero
  Rust sources newer), but I did **not** drive its critical path — no
  discovery run, no Stop, no export. The human walkthrough is outstanding.
- **The adversarial checklist was not worked.** Empty states, mid-flow
  refresh, and garbage input at the boundary are untested this pass.
- **No engineering-assessment pass.** The skill asks for a severity-ranked
  code audit folded into the verdict; not run here. So nothing has looked for
  the class of defect that a passing gate and a working happy path both miss.
- **`F-dual-framework` is `not_evaluated`** — "no package.json readable" at
  the repo root, which is a Rust workspace. The checker looks only at the
  root, so it never sees `apps/netscli-gui/package.json` and cannot report on
  framework duplication either way.

## To reach SHIP

The BLOCK is cleared. What remains cannot be done from this session:

1. A **fresh session** audits the work (`--acceptor-context separate`) — it
   must not have written the code or seen the plan.
2. Someone **drives the critical path** — discovery, Stop, export
   (`--runtime-verified`). F-3 and F-5 mean no automated suite can supply
   this today, so it is a human walkthrough.
3. `PRODUCT.md` declares its provenance, or intent stays unanchored (F-1 of
   the caps, not of the findings).
