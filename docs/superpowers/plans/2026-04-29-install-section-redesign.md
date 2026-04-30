# Install section redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 7-entry install grid in netscli.com's "Get started" section with an OS-tabbed UI: 3 tabs (Windows/macOS/Linux) auto-detected from the visitor's user agent, each tab showing one recommended command (always-visible Copy button) plus alternative rows.

**Architecture:** Pure-static Astro component. Data restructured from a flat `entries[]` array into per-OS arrays (`byPlatform.windows | macos | linux`), with position 0 = recommended. Tab swapping is a ~6-line vanilla JS DOM toggle in `index.astro`'s existing inline `<script>`. OS detection prefers `navigator.userAgentData.platform` (UA-CH) with fallback to `navigator.platform` and then to macOS. Layout is a 2-row CSS grid with explicit `grid-row` placement so the Try it sidebar sits level with the recommended card on the left.

**Tech Stack:** Astro 6.1.9, vanilla JS, vanilla CSS. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-04-29-install-section-redesign-design.md`](../specs/2026-04-29-install-section-redesign-design.md)

---

## Task 1: Restructure data + scaffold static component

Migrate `site.ts` to per-OS arrays and rewrite `Install.astro` to render the macOS panel statically (no tabs yet). At the end of this task the page builds clean, looks similar to today, but is using the new data shape and component layout.

**Files:**
- Modify: `site/src/data/site.ts:78-130` (interface + install block in `Site` type)
- Modify: `site/src/data/site.ts:259-303` (data values for `install` block)
- Modify: `site/src/components/Install.astro` (rewrite)

- [ ] **Step 1: Update `InstallEntry` and `Site.install` types in [site.ts](site/src/data/site.ts)**

Replace lines 78-86 (current `InstallEntry` interface) with:

```ts
export type Platform = 'windows' | 'macos' | 'linux';

export interface InstallEntry {
  label: string;
  /** Shell command(s) shown monospace with copy button. */
  command: string;
  /** Optional small hint. NOT rendered in the v7 design — kept on the
   *  type for possible future variants or SEO copy. */
  hint?: string;
}
```

Then locate the `install:` block inside the `Site` interface (around line 126) and replace:

```ts
  install: {
    entries: InstallEntry[];
    tryCommands: string[];
    binariesNote: string;
  };
```

with:

```ts
  install: {
    byPlatform: Record<Platform, InstallEntry[]>;
    tryCommands: string[];
    binariesNote: string;
  };
```

- [ ] **Step 2: Replace the `install` data block in [site.ts](site/src/data/site.ts)**

Locate the `install:` block in the data (around line 259) and replace the entire `entries: [...]` array with the new `byPlatform` structure. Note that Winget's command changes from `winget install fstubner.netscli` to `winget install netscli` (uses the Moniker we set in the manifest). Final block:

```ts
  install: {
    byPlatform: {
      windows: [
        {
          label: 'Winget',
          command: 'winget install netscli',
        },
        {
          label: 'Scoop',
          command:
            'scoop bucket add fstubner https://github.com/fstubner/scoop-bucket && scoop install netscli',
        },
        {
          label: 'PowerShell script',
          command:
            'iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex',
        },
        {
          label: 'Cargo',
          command: 'cargo install netscli',
        },
      ],
      macos: [
        {
          label: 'Homebrew',
          command: 'brew tap fstubner/tap && brew install netscli',
        },
        {
          label: 'Install script',
          command:
            'curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash',
        },
        {
          label: 'Cargo',
          command: 'cargo install netscli',
        },
      ],
      linux: [
        {
          label: 'Install script',
          command:
            'curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash',
        },
        {
          label: 'AUR (Arch)',
          command: 'yay -S netscli-bin',
        },
        {
          label: 'Homebrew',
          command: 'brew tap fstubner/tap && brew install netscli',
        },
        {
          label: 'Cargo',
          command: 'cargo install netscli',
        },
      ],
    },
    tryCommands: [
      'netscli discover',
      'netscli scan 192.168.1.1 -p 22,80,443',
      'netscli dns google.com',
      'netscli serve',
      'netscli --help',
    ],
    binariesNote:
      'Or grab binaries from <a href="https://github.com/fstubner/netscli/releases/latest" style="color:#ccc;text-decoration:underline;text-underline-offset:3px">the latest release</a>.',
  },
```

- [ ] **Step 3: Rewrite [Install.astro](site/src/components/Install.astro) to render macOS panel only**

Replace the entire file with:

```astro
---
import { site } from '../data/site';
const { install, copy } = site;
const { byPlatform, tryCommands, binariesNote } = install;
---
<section id="install">
  <div class="w">
    <h2>{copy.install.heading}</h2>
    <p class="lead" set:html={copy.install.leadHtml} />

    <div class="install-grid">
      <!-- Tabs row (col 1, row 1) - placeholder, wired up in Task 2 -->
      <div class="os-tabs" role="tablist">
        <button class="os-tab" data-os="windows">Windows</button>
        <button class="os-tab active" data-os="macos">macOS</button>
        <button class="os-tab" data-os="linux">Linux</button>
      </div>

      <!-- Install content (col 1, row 2) -->
      <div class="install-content">
        {(['windows', 'macos', 'linux'] as const).map((os) => (
          <div class={`os-panel ${os === 'macos' ? 'active' : ''}`} data-os={os}>
            <div class="reco">
              <div class="reco-meta">{byPlatform[os][0].label}</div>
              <div class="cmd big has-copy">{byPlatform[os][0].command}</div>
            </div>
            {byPlatform[os].length > 1 && (
              <div class="alts">
                {byPlatform[os].slice(1).map((e) => (
                  <div class="alt has-copy">
                    <div class="alt-label">{e.label}</div>
                    <div class="alt-cmd">{e.command}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <p class="footer-note" set:html={binariesNote} />
      </div>

      <!-- Try it (col 2, row 2) -->
      <div class="try">
        <h3 class="try-title">Try it</h3>
        <div
          class="tryblock"
          set:html={tryCommands
            .map((c) => `<span style="color:#888">$</span> ${c}`)
            .join('\n')}
        />
      </div>
    </div>
  </div>
</section>
```

Note: Tabs are visually present but inert — clicking them does nothing yet. Task 2 wires them up. Try it sidebar still uses the old `tryblock` shape — Task 4 restructures it.

- [ ] **Step 4: Verify build is clean**

Run from the project root:

```bash
cd site && npm run build 2>&1 | tail -8
```

Expected: `✓ Completed`, no TypeScript errors, no Astro warnings. If the type rename broke any other consumer (the existing `entries` field), TypeScript will flag it — fix by removing references.

- [ ] **Step 5: Verify rendered HTML has all 3 OS panels**

```bash
grep -oE 'data-os="(windows|macos|linux)"' site/dist/index.html | sort -u
```

Expected output:
```
data-os="linux"
data-os="macos"
data-os="windows"
```

(Each appears multiple times — once on the tab, once on the panel — but `sort -u` collapses to unique values.)

- [ ] **Step 6: Commit**

```bash
git add site/src/data/site.ts site/src/components/Install.astro
git commit -m "site: restructure install data to per-OS arrays + scaffold Install component"
```

---

## Task 2: Wire up OS tabs (click to swap)

Add the styles for tabs/panels and the `setOS()` JS that swaps active state on click. After this task, clicking Windows / macOS / Linux tabs swaps the visible panel.

**Files:**
- Modify: `site/src/styles/global.css` (append new selectors)
- Modify: `site/src/pages/index.astro` (extend the existing inline script)

- [ ] **Step 1: Append OS-tab and panel styles to [global.css](site/src/styles/global.css)**

Append to the end of the file:

```css
/* Install section: OS-tabbed redesign (2026-04-29). Two-row grid where
   the OS tabs span row 1 col 1 only; install panels and Try it sit in
   row 2, level with each other. */
.install-grid {
  display: grid;
  grid-template-columns: 1fr 360px;
  column-gap: 32px;
  align-items: start;
}
.os-tabs {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  gap: 0;
  border-bottom: 1px solid #222;
  margin-bottom: 20px;
}
.install-content {
  grid-column: 1;
  grid-row: 2;
}
.try {
  grid-column: 2;
  grid-row: 2;
}

.os-tab {
  padding: 12px 22px;
  color: #888;
  font-size: 0.9rem;
  cursor: pointer;
  user-select: none;
  border: none;
  background: transparent;
  font-family: inherit;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s;
}
.os-tab:hover { color: #ccc; }
.os-tab.active {
  color: #fafafa;
  border-bottom-color: #0ea5e9;
  font-weight: 500;
}

.os-panel { display: none; }
.os-panel.active { display: block; }

.reco {
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 14px 18px;
  margin-bottom: 16px;
}
.reco-meta {
  font-size: 0.85rem;
  font-weight: 500;
  color: #e0e0e0;
  margin-bottom: 8px;
}
.cmd.big {
  font-size: 1.05rem;
  padding-right: 74px;
}

.alts {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #1a1a1a;
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
}
.alt {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 16px;
  align-items: center;
  padding: 11px 16px;
  background: #0c0c0c;
  transition: background 0.15s;
  position: relative;
}
.alt:hover { background: #0f0f0f; }
.alt-label { font-size: 0.85rem; color: #bcbcbc; }
.alt-cmd {
  font-family: 'SF Mono', 'Menlo', Consolas, monospace;
  font-size: 0.82rem;
  color: #9aceeb;
  word-break: break-all;
  padding-right: 50px;
}

.footer-note {
  margin-top: 14px;
  font-size: 0.8125rem;
  color: #777;
}
```

- [ ] **Step 2: Add `setOS()` and click handler to [index.astro](site/src/pages/index.astro)**

Locate the existing inline `<script>` block (around lines 53-77) that contains the `.has-copy` copy-button setup. Append inside the same script tag, before the closing `</script>`:

```js
    // OS tab swap. Wired to onclick from buttons that have data-os.
    function setOS(os) {
      document.querySelectorAll(".os-tab").forEach((b) =>
        b.classList.toggle("active", b.dataset.os === os));
      document.querySelectorAll(".os-panel").forEach((p) =>
        p.classList.toggle("active", p.dataset.os === os));
    }
    document.querySelectorAll(".os-tab").forEach((b) => {
      b.addEventListener("click", () => setOS(b.dataset.os));
    });
```

- [ ] **Step 3: Verify build is clean**

```bash
cd site && npm run build 2>&1 | tail -5
```

Expected: `✓ Completed`.

- [ ] **Step 4: Manually verify tab swap in preview**

Start the dev server in another terminal:

```bash
cd site && npm run dev
```

Open the printed URL (usually `http://localhost:4321`). Verify:
- Three tab buttons visible: Windows, macOS, Linux
- macOS is the active (highlighted) tab on load
- Clicking each tab swaps the visible panel below
- Stop the dev server (Ctrl-C) when done

- [ ] **Step 5: Commit**

```bash
git add site/src/styles/global.css site/src/pages/index.astro
git commit -m "site: wire up OS tabs in install section"
```

---

## Task 3: Add OS auto-detection on page load

Detect the visitor's OS via `navigator.userAgentData.platform` (with fallbacks) and call `setOS()` on `DOMContentLoaded` so the right tab is pre-selected.

**Files:**
- Modify: `site/src/pages/index.astro` (extend the inline script from Task 2)

- [ ] **Step 1: Add detection script in [index.astro](site/src/pages/index.astro)**

In the same inline `<script>` block, after the `setOS` definition and click-handler setup but inside the script tag, append:

```js
    // Auto-detect visitor OS on load. UA-CH preferred; falls back to the
    // deprecated navigator.platform; final fallback macOS for unknowns.
    {
      const ua =
        (navigator.userAgentData && navigator.userAgentData.platform) ||
        navigator.platform ||
        "";
      const detected = /win/i.test(ua)
        ? "windows"
        : /mac/i.test(ua)
          ? "macos"
          : /linux/i.test(ua)
            ? "linux"
            : "macos";
      setOS(detected);
    }
```

The block scope (`{ ... }`) keeps `ua` and `detected` from leaking into the surrounding script.

- [ ] **Step 2: Verify build is clean**

```bash
cd site && npm run build 2>&1 | tail -5
```

Expected: `✓ Completed`.

- [ ] **Step 3: Manually verify detection in preview**

Start the dev server:

```bash
cd site && npm run dev
```

Open the URL. The active tab should match your OS:
- On Windows → Windows tab active
- On macOS → macOS tab active
- On Linux → Linux tab active

To verify the OTHER detection paths work, open browser DevTools console and run:

```js
// Simulate macOS detection (paste in console)
Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
location.reload();
```

(Note: some browsers ignore the override after first read; if so, just trust the default-OS check.)

Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add site/src/pages/index.astro
git commit -m "site: auto-detect visitor OS for install tab pre-selection"
```

---

## Task 4: Always-visible recommended Copy + Try it row restructure

Add a CSS variant `.has-copy.always-show` so the recommended card's copy button is visible without hover. Restructure the Try it sidebar from a single `<pre>`-style block into one row per command, each with its own `.has-copy`.

**Files:**
- Modify: `site/src/styles/global.css` (append more selectors)
- Modify: `site/src/components/Install.astro` (restructure Try it block)

- [ ] **Step 1: Append `.always-show` and Try-it row styles to [global.css](site/src/styles/global.css)**

Append to the end of the file:

```css
/* Always-visible variant: recommended card uses .has-copy.always-show
   so the primary install action's copy button is always discoverable. */
.has-copy.always-show .copy-btn {
  opacity: 1;
  background: #102532;
  border-color: #1e3a5f;
  color: #9aceeb;
}
.has-copy.always-show .copy-btn:hover {
  background: #15334a;
  color: #bce0f5;
}

/* Try it sidebar — one clickable row per command, each with .has-copy
   so the existing copy-button JS hooks it. */
.try {
  background: #0a0a0a;
  border: 1px solid #1f1f1f;
  border-radius: 10px;
  padding: 18px 18px;
}
.try-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #fafafa;
  margin: 0 0 12px;
}
.try-cmd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 5px;
  font-family: 'SF Mono', 'Menlo', Consolas, monospace;
  font-size: 0.83rem;
  color: #bcbcbc;
  cursor: text;
  transition: background 0.15s;
  position: relative;
}
.try-cmd:hover { background: #101010; }
.try-cmd .p { color: #555; user-select: none; }
.try-cmd .t {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
```

- [ ] **Step 2: Update [Install.astro](site/src/components/Install.astro) — recommended uses `always-show`, Try it becomes per-row**

Two edits in the same file:

(a) Find the recommended card's `<div class="cmd big has-copy">` and change it to `<div class="cmd big has-copy always-show">`. There's one such line per OS panel — three changes.

The simplest way is to change the JSX expression in the `.map`:

```astro
            <div class="reco">
              <div class="reco-meta">{byPlatform[os][0].label}</div>
              <div class="cmd big has-copy always-show">{byPlatform[os][0].command}</div>
            </div>
```

(b) Replace the Try it block. Find:

```astro
      <div class="try">
        <h3 class="try-title">Try it</h3>
        <div
          class="tryblock"
          set:html={tryCommands
            .map((c) => `<span style="color:#888">$</span> ${c}`)
            .join('\n')}
        />
      </div>
```

Replace with:

```astro
      <div class="try">
        <h3 class="try-title">Try it</h3>
        {tryCommands.map((c) => (
          <div class="try-cmd has-copy">
            <span class="p">$</span><span class="t">{c}</span>
          </div>
        ))}
      </div>
```

The existing `.has-copy` JS in `index.astro` strips trailing "Copy" text and `$` prompt prefix — both still apply, so each row copies cleanly.

- [ ] **Step 3: Verify build is clean**

```bash
cd site && npm run build 2>&1 | tail -5
```

Expected: `✓ Completed`.

- [ ] **Step 4: Manually verify in preview**

```bash
cd site && npm run dev
```

Verify:
- Recommended card's "Copy" button is visible WITHOUT hovering, in a teal style
- Hover over an alternative row → "Copy" button fades in on the right
- Click any "Copy" button → button shows "Copied!" briefly, command lands on clipboard
- Try it sidebar: each `$ netscli ...` is its own row with a hover-revealed Copy button

Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add site/src/styles/global.css site/src/components/Install.astro
git commit -m "site: always-show copy on recommended; per-row Try it commands"
```

---

## Task 5: Mobile responsive breakpoint

Add a media query so the install grid collapses to one column at narrow viewports (< 800px), with Try it stacked below.

**Files:**
- Modify: `site/src/styles/global.css` (append @media query)

- [ ] **Step 1: Append mobile styles to [global.css](site/src/styles/global.css)**

```css
@media (max-width: 800px) {
  .install-grid {
    grid-template-columns: 1fr;
  }
  .os-tabs { grid-column: 1; grid-row: auto; }
  .install-content { grid-column: 1; grid-row: auto; }
  .try {
    grid-column: 1;
    grid-row: auto;
    margin-top: 24px;
  }
}
```

- [ ] **Step 2: Verify build is clean**

```bash
cd site && npm run build 2>&1 | tail -5
```

Expected: `✓ Completed`.

- [ ] **Step 3: Manually verify mobile layout**

```bash
cd site && npm run dev
```

In the browser, narrow the window to <800px wide (or open DevTools and toggle device toolbar to a phone preset). Verify:
- Install grid collapses to single column
- OS tabs sit at the top
- Install panels render below tabs
- Try it sidebar drops below the install panels with a small top margin
- Tab clicking still works
- Copy buttons still work

Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add site/src/styles/global.css
git commit -m "site: install section responsive breakpoint at 800px"
```

---

## Task 6: Final smoke-test + ship

End-to-end verification across all three tabs, then push to deploy.

**Files:** None modified.

- [ ] **Step 1: Final clean build**

```bash
cd site && npm run build 2>&1 | tail -8
```

Expected: `✓ Completed`. No warnings.

- [ ] **Step 2: Smoke-test rendered HTML for all platforms' commands**

```bash
grep -oE '(winget install netscli|brew tap fstubner/tap|yay -S netscli-bin|cargo install netscli|scoop bucket add fstubner|install\.sh \| bash|install\.ps1 \| iex)' site/dist/index.html | sort -u
```

Expected: 7 unique commands present (one for each install method across all 3 OS arrays).

- [ ] **Step 3: Manual browser smoke-test**

```bash
cd site && npm run dev
```

For EACH OS tab (click through Windows → macOS → Linux):
- Recommended card visible, with always-on Copy button
- Alternative rows present in correct order (per spec)
- All commands legible, no overflow
- Click each Copy button — verify command lands on clipboard

Then:
- Resize to mobile width — verify stacking
- Reload the page — verify your OS is the auto-detected default tab

Stop the dev server when done.

- [ ] **Step 4: Push and verify deploy**

```bash
git push origin main
```

Wait ~30s for the GitHub Pages workflow to run, then:

```bash
gh run list --repo fstubner/netscli --branch main --limit 1 --json status,conclusion,name
```

Expected: `Deploy GitHub Pages` with `conclusion: "success"`.

If deployed, smoke-test the live URL:

```bash
curl -fsSL https://netscli.com/ | grep -oE 'data-os="(windows|macos|linux)"' | sort -u
```

Expected: all three OS tags present in the rendered HTML.

- [ ] **Step 5: Done**

The install section redesign is live on netscli.com. No further commits needed.

---

## Out of scope (per spec)

- Smart "promoted" hints based on visitor analytics
- Persisting tab choice across sessions (localStorage)
- Animated tab transitions
- Refactoring `index.astro`'s inline scripts beyond appending to them
