#!/usr/bin/env node
//
// Reads the real colour tokens out of the CSS for both surfaces -- the desktop
// app and the site -- checks every foreground against every surface for WCAG
// contrast, and writes the `design-tokens.json` each frontend checker reads.
//
//   node scripts/design-tokens.mjs           # check (CI)
//   node scripts/design-tokens.mjs --write   # regenerate the JSON
//
// Why generated rather than hand-written: `tokens.css` is the single source of
// truth and a hand-maintained JSON copy drifts from it. A drifted copy is worse
// than no copy, because the contrast gate then passes against values that are
// not what ships -- a green check standing in for an unchecked property.
//
// Why the full cross-product rather than an audited list of pairs that real CSS
// rules combine: an audited list needs updating every time a rule pairs a new
// colour with a new surface, and the update is exactly what gets forgotten. The
// cross-product is stricter than reality and needs no maintenance. It is also
// what caught `--red` on `--bg-selected` at 3.76 -- the "Down" label on a
// hovered interface row, which an audited list did not have in it.
//
// The 4.5:1 bar is WCAG AA for body text. Several of these colours are only
// ever used at 11px, which is squarely body text; none of them qualify for the
// 3:1 large-text allowance.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The two surfaces with their own palettes. They share nothing but this
 * script: the desktop app has one `tokens.css` on `.container`, the site
 * layers Starlight's `--sl-color-*` over a small shared `:root` block.
 *
 * `surface-base` is deliberately the *tightest* surface per theme rather than
 * the nominal base one, because that is where contrast is worst. For the app,
 * bg-base scored text-muted at 4.54 while bg-elevated -- the settings dialog's
 * own background -- was at 4.13, so mapping the flattering surface would have
 * passed the gate with the dialog still unreadable.
 */
const TARGETS = [
  {
    name: 'desktop app',
    css: ['apps/netscli-gui/src/styles/tokens.css'],
    json: 'apps/netscli-gui/design-tokens.json',
    themes: { dark: '.container', light: '.container.theme-light' },
    // The light block restates only what it overrides.
    inheritsFrom: 'dark',
    foregrounds: ['text-primary', 'text-secondary', 'text-muted', 'mint', 'cyan', 'red', 'amber'],
    surfaces: ['bg-body', 'bg-base', 'bg-elevated', 'bg-input', 'bg-toolbar', 'bg-selected'],
    keys: {
      dark: { 'surface-base': 'bg-elevated', 'text-main': 'text-primary', 'text-muted': 'text-muted', accent: 'mint' },
      light: { 'surface-base': 'bg-body', 'text-main': 'text-primary', 'text-muted': 'text-muted', accent: 'mint' },
    },
  },
  {
    name: 'site',
    // tokens.css carries the brand accent under `:root`; the Starlight file
    // reaches it with `--sl-color-accent: var(--netscli-accent)`, which is why
    // values are resolved through one level of var() before use.
    css: ['site/src/styles/tokens.css', 'site/src/styles/starlight/01-tokens-and-header.css'],
    json: 'site/design-tokens.json',
    themes: { dark: "html[data-theme='dark']", light: "html[data-theme='light']" },
    sharedSelector: ':root',
    // Starlight inverts its own naming in the light theme -- `--sl-color-white`
    // is #111827 there -- so white/gray-1..3 are the text ramp in both themes
    // and black/bg/gray-6 are the surfaces in both.
    foregrounds: ['sl-color-white', 'sl-color-gray-1', 'sl-color-gray-2', 'sl-color-gray-3', 'sl-color-accent'],
    surfaces: ['sl-color-bg', 'sl-color-bg-sidebar', 'sl-color-black', 'sl-color-gray-6'],
    keys: {
      dark: { 'surface-base': 'sl-color-bg', 'text-main': 'sl-color-gray-2', 'text-muted': 'sl-color-gray-3', 'text-strong': 'sl-color-white', accent: 'sl-color-accent' },
      light: { 'surface-base': 'sl-color-gray-6', 'text-main': 'sl-color-gray-2', 'text-muted': 'sl-color-gray-3', 'text-strong': 'sl-color-white', accent: 'sl-color-accent' },
    },
  },
];

/**
 * Custom properties declared for `selector`, merged across every rule that
 * names it.
 *
 * Matching is on one comma-separated part of the selector list, not a prefix.
 * Both details are load-bearing: the site writes
 * `html[data-theme='dark'], html[data-theme='dark'] ::backdrop {`, which a
 * `^selector\s*\{` anchor misses entirely and would have reported as "no rule";
 * and a prefix match on `.container` would also match `.container.theme-light`
 * and silently read the wrong theme.
 *
 * Later rules win, matching the cascade for equal specificity.
 */
function parseTokens(css, selector) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = {};
  let found = false;
  for (const [, selectorList, body] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const names = selectorList.split(',').map((part) => part.trim().replace(/\s+/g, ' '));
    if (!names.includes(selector)) continue;
    found = true;
    for (const [, name, raw] of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      const value = raw.trim();
      // Colours only: the same blocks carry sizes, z-indexes and rgb triples.
      if (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^var\(\s*--[a-z0-9-]+\s*\)$/.test(value)) {
        tokens[name] = value.toLowerCase();
      }
    }
  }
  if (!found) throw new Error(`No rule for selector ${selector}`);
  return tokens;
}

function relativeLuminance(hex) {
  const channels = hex.replace('#', '').match(/../g).map((pair) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Resolve one level of `var(--other-token)` against the same theme's map. */
function resolveVars(tokens) {
  const resolved = { ...tokens };
  for (const [name, value] of Object.entries(resolved)) {
    const reference = /^var\(\s*--([a-z0-9-]+)\s*\)$/.exec(value);
    if (reference && resolved[reference[1]]) resolved[name] = resolved[reference[1]];
  }
  return resolved;
}

// Compared with line endings normalised, not byte for byte. `.gitattributes`
// sets `* text=auto`, so these files are checked out CRLF on Windows and LF on
// the Linux runner while the generator always emits LF. A byte comparison
// therefore passed CI and failed on every Windows working copy -- a guard that
// is green where nobody reads it and red where the maintainer works is worse
// than none.
const normalise = (text) => text.replace(/\r\n/g, '\n');

const write = process.argv.includes('--write');
const failures = [];
let checkedPairs = 0;

for (const target of TARGETS) {
  const css = target.css.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
  const shared = target.sharedSelector ? parseTokens(css, target.sharedSelector) : {};

  const themes = {};
  for (const [theme, selector] of Object.entries(target.themes)) {
    themes[theme] = { ...shared, ...parseTokens(css, selector) };
  }
  if (target.inheritsFrom) {
    for (const theme of Object.keys(themes)) {
      if (theme !== target.inheritsFrom) {
        themes[theme] = { ...themes[target.inheritsFrom], ...themes[theme] };
      }
    }
  }
  for (const theme of Object.keys(themes)) themes[theme] = resolveVars(themes[theme]);

  for (const [theme, tokens] of Object.entries(themes)) {
    for (const fg of target.foregrounds) {
      for (const bg of target.surfaces) {
        if (!tokens[fg] || !tokens[bg]) {
          failures.push(`${target.name} ${theme}: missing token --${tokens[fg] ? bg : fg}`);
          continue;
        }
        checkedPairs += 1;
        const ratio = contrast(tokens[fg], tokens[bg]);
        if (ratio < 4.5) {
          failures.push(
            `${target.name} ${theme}: --${fg} (${tokens[fg]}) on --${bg} (${tokens[bg]}) = ${ratio.toFixed(2)} < 4.5`,
          );
        }
      }
    }
  }

  const generated = Object.fromEntries(
    Object.entries(target.keys).map(([theme, mapping]) => [
      theme,
      Object.fromEntries(Object.entries(mapping).map(([key, token]) => [key, themes[theme][token]])),
    ]),
  );
  const serialized = `${JSON.stringify(generated, null, 2)}\n`;
  const jsonPath = path.join(repoRoot, target.json);

  if (write) {
    fs.writeFileSync(jsonPath, serialized);
    console.log(`Wrote ${target.json}`);
  } else if (!fs.existsSync(jsonPath)) {
    failures.push(`${target.json} is missing; run: node scripts/design-tokens.mjs --write`);
  } else if (normalise(fs.readFileSync(jsonPath, 'utf8')) !== normalise(serialized)) {
    failures.push(
      `${target.json} is out of date with its CSS; run: node scripts/design-tokens.mjs --write`,
    );
  }
}

if (failures.length > 0) {
  console.error('Design token check failed:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Design tokens OK: ${checkedPairs} contrast pairs >= 4.5:1 across ${TARGETS.length} surfaces.`,
  );
}
