#!/usr/bin/env node
//
// Reads the desktop app's real colour tokens out of `tokens.css`, checks every
// foreground against every surface for WCAG contrast, and writes the
// `design-tokens.json` that the frontend checker reads.
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
const cssPath = path.join(repoRoot, 'apps/netscli-gui/src/styles/tokens.css');
const jsonPath = path.join(repoRoot, 'apps/netscli-gui/design-tokens.json');

const THEMES = {
  dark: '.container',
  light: '.container.theme-light',
};

/** Tokens that are painted as text or as an icon on top of a surface. */
const FOREGROUNDS = ['text-primary', 'text-secondary', 'text-muted', 'mint', 'cyan', 'red', 'amber'];
/** Tokens used as a background behind that text. */
const SURFACES = ['bg-body', 'bg-base', 'bg-elevated', 'bg-input', 'bg-toolbar', 'bg-selected'];

/**
 * The keys the frontend checker requires, mapped onto this app's names.
 *
 * `surface-base` is deliberately the *tightest* surface per theme rather than
 * the nominal base one: bg-elevated is the lightest dark surface and bg-body
 * the darkest light one, so each is where contrast is worst. Mapping the easy
 * surface would let the gate pass while the dialog it actually ships stayed
 * unreadable -- bg-base scored text-muted at 4.54 while bg-elevated, the
 * settings dialog's own background, was at 4.13.
 */
const CHECKER_KEYS = {
  dark: { 'surface-base': 'bg-elevated', 'text-main': 'text-primary', 'text-muted': 'text-muted', accent: 'mint' },
  light: { 'surface-base': 'bg-body', 'text-main': 'text-primary', 'text-muted': 'text-muted', accent: 'mint' },
};

function parseTokens(css, selector) {
  // Match the selector's own block. The escape matters: `.container` would
  // otherwise also match `.container.theme-light` and silently read the wrong
  // theme's values.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!block) throw new Error(`No rule for ${selector} in tokens.css`);
  const tokens = {};
  for (const [, name, value] of block[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[name] = value.toLowerCase();
  }
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

const css = fs.readFileSync(cssPath, 'utf8');
const themes = Object.fromEntries(
  Object.entries(THEMES).map(([name, selector]) => [name, parseTokens(css, selector)]),
);

// Light inherits from the dark block, so only overridden tokens are restated.
themes.light = { ...themes.dark, ...themes.light };

const failures = [];
let checked = 0;
for (const [theme, tokens] of Object.entries(themes)) {
  for (const fg of FOREGROUNDS) {
    for (const bg of SURFACES) {
      if (!tokens[fg] || !tokens[bg]) {
        failures.push(`${theme}: missing token --${tokens[fg] ? bg : fg}`);
        continue;
      }
      checked += 1;
      const ratio = contrast(tokens[fg], tokens[bg]);
      if (ratio < 4.5) {
        failures.push(`${theme}: --${fg} (${tokens[fg]}) on --${bg} (${tokens[bg]}) = ${ratio.toFixed(2)} < 4.5`);
      }
    }
  }
}

const generated = Object.fromEntries(
  Object.entries(CHECKER_KEYS).map(([theme, mapping]) => [
    theme,
    Object.fromEntries(Object.entries(mapping).map(([key, token]) => [key, themes[theme][token]])),
  ]),
);
const serialized = `${JSON.stringify(generated, null, 2)}\n`;

// Compared with line endings normalised, not byte for byte. `.gitattributes`
// sets `* text=auto`, so this file is checked out CRLF on Windows and LF on the
// Linux runner while the generator always emits LF. A byte comparison therefore
// passed CI and failed on every Windows working copy -- a guard that is green
// where nobody reads it and red where the maintainer works is worse than none.
const normalise = (text) => text.replace(/\r\n/g, '\n');

if (process.argv.includes('--write')) {
  fs.writeFileSync(jsonPath, serialized);
  console.log(`Wrote ${path.relative(repoRoot, jsonPath)}`);
} else if (!fs.existsSync(jsonPath)) {
  failures.push('design-tokens.json is missing; run: node scripts/design-tokens.mjs --write');
} else if (normalise(fs.readFileSync(jsonPath, 'utf8')) !== normalise(serialized)) {
  failures.push(
    'design-tokens.json is out of date with tokens.css; run: node scripts/design-tokens.mjs --write',
  );
}

if (failures.length > 0) {
  console.error('Design token check failed:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Design tokens OK: ${checked} contrast pairs >= 4.5:1 across ${Object.keys(themes).length} themes.`);
}
