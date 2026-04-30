# Install section redesign — design

**Date**: 2026-04-29
**Status**: Design approved; ready for implementation planning
**Scope**: `site/src/components/Install.astro`, `site/src/data/site.ts`,
inline JS in `site/src/pages/index.astro`

## Motivation

The "Get started" section on netscli.com renders all install methods as a
flat list. With 7 entries (Homebrew, Winget, Scoop, AUR, Cargo, install.sh,
install.ps1), the panel feels cramped and forces every visitor to scan
options that don't apply to their OS.

Goal: reduce cognitive load for the typical visitor, surface a single
recommended command per OS, keep alternatives discoverable but not
distracting.

## High-level design

OS-tabbed UI with auto-detected default tab.

```
┌──────────────────────────────────────┐
│  Get started                          │
│  Install, then run.  Full README →    │
│                                       │
│  Windows  [macOS]  Linux              ┌─────────────┐
│  ──────────────                       │  Try it     │
│                                       │             │
│  ┌─────────────────────────────────┐  │  $ ...      │
│  │ Homebrew                  [Copy]│  │  $ ...      │
│  │ brew tap fstubner/tap && ...    │  │  $ ...      │
│  └─────────────────────────────────┘  └─────────────┘
│                                       │
│  ┌─────────────────────────────────┐  │
│  │ Install script   curl -fsSL ... │  │
│  │ Cargo            cargo install  │  │
│  └─────────────────────────────────┘  │
│                                       │
│  Or grab binaries from the latest…    │
└──────────────────────────────────────┘
```

Three OS tabs anchored above the install column only. The "Try it" sidebar
sits in the second grid row, level with the recommended card on the left.

## Data model

`site/src/data/site.ts` — replace the flat `entries[]` array with a
per-OS structure:

```ts
export type Platform = 'windows' | 'macos' | 'linux';

export interface InstallEntry {
  label: string;
  command: string;
  /** Kept on the type for possible future variants (richer descriptions,
   *  SEO copy). NOT rendered in this design — both the recommended card
   *  and alternative rows show only label + command. */
  hint?: string;
}

// install.byPlatform[os][0] is the recommended entry for that OS;
// remaining entries render as alternative rows in array order.
install: {
  byPlatform: Record<Platform, InstallEntry[]>;
  tryCommands: string[];
  binariesNote: string;
}
```

Cross-platform entries (Cargo, Homebrew, install.sh) are duplicated across
the relevant per-OS arrays. Total entries grow from 7 unique to 11 with
duplicates — accepted in exchange for unambiguous per-OS ordering and
zero render-time filtering logic.

Final per-OS arrays:

```
windows: [Winget, Scoop, PowerShell script, Cargo]
macos:   [Homebrew, Install script, Cargo]
linux:   [Install script, AUR, Homebrew, Cargo]
```

Position 0 in each array is the recommended (hero) entry. Choices:

- **Windows** → Winget (preinstalled on Win10/11)
- **macOS** → Homebrew (de facto standard)
- **Linux** → install.sh (works on every distro, no prereqs)

## Component architecture

`Install.astro` becomes a 2-row CSS grid:

```
column 1                          column 2
─────────────────────────────────────────────
row 1: OS tab bar                 (empty)
row 2: install panels + footer    Try it card
```

Achieved with `grid-template-columns: 1fr 360px` plus explicit
`grid-row: 1`/`grid-row: 2` placement so Try it skips row 1.

For each OS, the active panel renders:

1. Recommended card — `.reco` wrapper, label + `.cmd.big` with always-on
   `.copy-btn.always`.
2. Alternatives — `.alts` table, each row is a `.alt` (label + cmd +
   hover-only `.copy-btn`).

Only the active panel is `display: block`; the others are `display: none`.
SSR renders all three panels but only the macOS one is visible by default.

## OS detection

Inline `<script>` in `index.astro` (next to the existing `.has-copy`
copy-button JS) runs on `DOMContentLoaded`:

```js
const ua = navigator.userAgentData?.platform || navigator.platform || '';
const os = /win/i.test(ua)   ? 'windows'
         : /mac/i.test(ua)   ? 'macos'
         : /linux/i.test(ua) ? 'linux'
         : 'macos'; // fallback
setOS(os);
```

`setOS(os)` toggles `.active` on the matching tab button + panel.

`navigator.userAgentData` is preferred (UA-CH supersedes the deprecated
`navigator.platform`); falls back to `navigator.platform` for browsers
without UA-CH; falls back to `'macos'` if both are unavailable.

## Try it sidebar

Currently a single `<pre>`-style block. New structure: a `.try` container
with one `.try-cmd` row per command. Each row has its own hover-revealed
`.copy-btn`. Click anywhere on the row to copy.

The 5 existing example commands stay the same.

## Tab swap behavior

Pure DOM toggle (no framework, no state library):

```js
function setOS(os) {
  document.querySelectorAll('.os-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.os === os));
  document.querySelectorAll('.os-panel').forEach(p =>
    p.classList.toggle('active', p.dataset.os === os));
}
```

Bound to `onclick` on each tab button.

## Copy buttons

Reuse the existing `.has-copy` JS handler in `index.astro`, which iterates
every `.has-copy` element on the page and appends a programmatically-created
`.copy-btn`. Two visual modes are CSS-only variants triggered by an extra
class on the parent:

- **Always-visible** — parent has `.has-copy.always-show`. CSS rule:
  `.has-copy.always-show .copy-btn { opacity: 1 }`. Used on the recommended
  card so the primary action is one click away with no hover discovery cost.
- **Hover-only** — parent has `.has-copy` only (existing default). Used on
  alternative rows + Try it rows. Keeps secondary actions visually quiet.

No changes to the JS handler itself; only CSS additions.

## Mobile / responsive

Single-column at `< 800px`:

- Grid collapses to one column
- OS tabs and Try it stack below the install panels
- Try it gets `margin-top: 24px` for breathing room

Tab UI itself stays unchanged on mobile (3 tabs fit comfortably).

## Out of scope

- Smart "promoted" hints based on visitor analytics. The recommended entry
  is fixed per OS in the data file.
- Persisting the user's tab choice across sessions (localStorage). Not
  worth the complexity for a single-page site.
- Animated tab transitions. Visibility toggle is instant.
- Refactoring `index.astro`'s inline scripts. The new code lives next to
  the existing `.has-copy` handler.

## Verification

- `npm run build` clean (no Astro/TS warnings)
- Smoke-test in browser preview:
  - Each tab renders correct entries in correct order
  - Tab clicking swaps panels instantly
  - OS auto-detection picks the visitor's tab on load
  - All copy buttons work (recommended + alternatives + Try it rows)
  - Mobile breakpoint (≤ 800px) stacks correctly
- No regressions in surrounding sections (Hero, Surfaces, FAQ unchanged)

## Files affected

- `site/src/components/Install.astro` — rewrite (largest change)
- `site/src/data/site.ts` — replace flat `entries[]` with per-OS
  `byPlatform` arrays
- `site/src/styles/global.css` — append new selectors (OS tabs, reco card,
  alts, try-cmd, mobile breakpoint)
- `site/src/pages/index.astro` — append `setOS()` + auto-detect script
  next to existing `.has-copy` handler
