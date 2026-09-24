// Re-brand the site from one accent colour.
//
//   npm run theme -- --accent "#7c3aed"
//   npm run theme -- --accent "#7c3aed" --dry-run
//
// The accent is not one token. It is a family of six per theme -- the base,
// a hover step, a pale step, the channel triple that rgba() call sites read,
// the ink drawn ON the accent, and two of the three wordmark gradient stops
// -- and the two themes pull in opposite directions: on a near-black page a
// hover state is LIGHTER than the base, on a white page it is DARKER. Twelve
// values, four of them with a contrast floor to clear.
//
// Hand-editing that is how the light theme once shipped with the dark
// theme's accent still in place: 2.0:1 on white, across every accent-coloured
// link on the landing page, invisible to review because the page still looked
// deliberate.
//
// So this derives all twelve, and refuses to write a set that fails. Where
// the colour you asked for cannot clear 4.5:1 against that theme's page, it
// says so and uses the nearest lightness that does, rather than writing the
// failure and leaving the contrast gate to find it later.
//
// It rewrites src/styles/tokens.css, the landing tier's copies in
// landing/tokens.css, and the inline-code ink in code-surface.css; the docs
// and landing rules read the accent through those tokens rather than
// repeating its value. Run the real gates afterwards:
// `npm run check:contrast` measures what the browser actually paints, which
// is the thing that counts.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokensPath = path.join(root, 'src', 'styles', 'tokens.css');
// The landing tier keeps its own accent copies: one for text on the dark
// bands of a light page, one for the light chips. They are the same two
// colours as the themes above, written out again because they apply on
// surfaces that do not follow the page theme -- so a re-brand that skipped
// this file left every command chip and install band still the old colour.
const landingTokensPath = path.join(root, 'src', 'styles', 'landing', 'tokens.css');
const codeSurfacePath = path.join(root, 'src', 'styles', 'code-surface.css');

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1] ?? null;
};
const accentArg = flag('accent');
const dryRun = argv.includes('--dry-run');
const verify = argv.includes('--verify');

if (!accentArg) {
  console.error('Usage: npm run theme -- --accent "#7c3aed" [--dry-run] [--verify]');
  process.exit(2);
}
if (dryRun && verify) {
  console.error('--verify builds the site and measures it, so it cannot run with --dry-run.');
  process.exit(2);
}

// ---- colour ----------------------------------------------------------------

const hexToRgb = (hex) => {
  const clean = hex.trim().replace(/^#/, '');
  const full = clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance. */
const luminance = ([r, g, b]) => {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const rgbToHsl = ([r, g, b]) => {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
};

const hslToRgb = ([h, s, l]) => {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let v = t;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 1 / 2) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => v * 255);
};

const withLightness = (rgb, l) => {
  const [h, s] = rgbToHsl(rgb);
  return hslToRgb([h, s, Math.min(1, Math.max(0, l))]);
};

/**
 * The nearest colour of this hue that clears `floor` against `against`,
 * walking lightness in `direction` (-1 darker, +1 lighter) from `rgb`.
 * Returns the input unchanged when it already clears.
 */
const clearing = (rgb, against, floor, direction) => {
  if (contrast(rgb, against) >= floor) return rgb;
  const [, , start] = rgbToHsl(rgb);
  for (let step = 1; step <= 100; step += 1) {
    const candidate = withLightness(rgb, start + direction * step * 0.01);
    if (contrast(candidate, against) >= floor) return candidate;
  }
  return direction < 0 ? [0, 0, 0] : [255, 255, 255];
};

// ---- what the themes are ---------------------------------------------------

const source = fs.readFileSync(tokensPath, 'utf8');

/** The value of `name` inside the block that starts at `from`. */
const valueAt = (name, from) => {
  const at = source.indexOf(`--${name}:`, from);
  if (at === -1) return null;
  return source.slice(at + name.length + 3, source.indexOf(';', at)).trim();
};

const lightBlock = source.indexOf("html[data-theme='light']");

// Not the page colour: the WORST surface the accent is drawn on. Accent links
// sit on raised panels and sidebars too, and a value derived against #111111
// alone measured 4.67:1 there while rendering 3.60:1 on the docs sidebar --
// which is what the contrast sweep reported, and why this reads all three.
// Composited overlays can still be a step lighter again, so --verify below
// checks the built page rather than trusting this.
const surfaces = (from) =>
  ['ui-bg', 'ui-surface', 'ui-surface-raised'].map((token) => hexToRgb(valueAt(token, from))).filter(Boolean);
const darkSurfaces = surfaces(0);
const lightSurfaces = surfaces(lightBlock);
const darkBg = darkSurfaces.sort((a, b) => luminance(b) - luminance(a))[0];
const lightBg = lightSurfaces.sort((a, b) => luminance(a) - luminance(b))[0];

const accent = hexToRgb(accentArg);
if (!accent) {
  console.error(`"${accentArg}" is not a hex colour. Give it as "#7c3aed".`);
  process.exit(2);
}
if (!darkBg || !lightBg) {
  console.error('Could not read --ui-bg for both themes from src/styles/tokens.css.');
  process.exit(1);
}

const FLOOR = 4.5;
const adjustments = [];

// Dark theme: the accent sits on a near-black page, so it lightens to clear.
const darkAccent = clearing(accent, darkBg, FLOOR, +1);
if (darkAccent !== accent) {
  adjustments.push(
    `dark: ${rgbToHex(accent)} is ${contrast(accent, darkBg).toFixed(2)}:1 on ${rgbToHex(darkBg)}, ` +
      `lightened to ${rgbToHex(darkAccent)} for ${contrast(darkAccent, darkBg).toFixed(2)}:1`
  );
}
// Hover is further from the page: lighter still on dark, darker on light.
const darkBright = withLightness(darkAccent, Math.min(0.92, rgbToHsl(darkAccent)[2] + 0.18));
const darkHigh = withLightness(darkAccent, Math.min(0.96, rgbToHsl(darkAccent)[2] + 0.3));

// Light theme: the same hue, darkened until it clears white. It starts at a
// mid lightness rather than at its darkest, because "clears the floor" and
// "still reads as the brand colour" are different things -- pushed to
// maximum contrast every hue converges on near-black.
const lightAccent = clearing(withLightness(accent, 0.44), lightBg, FLOOR, -1);
const lightBright = clearing(withLightness(lightAccent, Math.max(0.08, rgbToHsl(lightAccent)[2] - 0.08)), lightBg, FLOOR, -1);
const lightHigh = withLightness(lightBright, Math.max(0.06, rgbToHsl(lightBright)[2] - 0.06));

// Ink drawn ON the accent fill, per theme: whichever of near-black or white
// has more room against it.
const inkFor = (fill) => {
  const black = [6, 19, 15];
  const white = [255, 255, 255];
  return contrast(white, fill) >= contrast(black, fill) ? white : black;
};

const channels = (rgb) => rgb.map((v) => Math.round(v)).join(', ');

const replacements = [
  // [token, value, which block]
  ['ui-accent', rgbToHex(darkAccent), 'dark'],
  ['ui-accent-rgb', channels(darkAccent), 'dark'],
  ['ui-accent-bright', rgbToHex(darkBright), 'dark'],
  ['ui-accent-high', rgbToHex(darkHigh), 'dark'],
  ['ui-on-accent', rgbToHex(inkFor(darkAccent)), 'dark'],
  ['ui-brand-gradient-from', rgbToHex(withLightness(darkAccent, Math.max(0.16, rgbToHsl(darkAccent)[2] - 0.12))), 'dark'],
  ['ui-brand-gradient-via', rgbToHex(darkAccent), 'dark'],
  ['ui-accent', rgbToHex(lightAccent), 'light'],
  ['ui-accent-rgb', channels(lightAccent), 'light'],
  ['ui-accent-bright', rgbToHex(lightBright), 'light'],
  ['ui-accent-high', rgbToHex(lightHigh), 'light'],
  ['ui-on-accent', rgbToHex(inkFor(lightAccent)), 'light'],
  ['ui-brand-gradient-from', rgbToHex(withLightness(lightAccent, Math.max(0.1, rgbToHsl(lightAccent)[2] - 0.1))), 'light'],
  ['ui-brand-gradient-via', rgbToHex(lightAccent), 'light'],
];

let next = source;
let written = 0;
for (const [token, value, theme] of replacements) {
  const from = theme === 'light' ? next.indexOf("html[data-theme='light']") : 0;
  const at = next.indexOf(`--${token}:`, from);
  if (at === -1) {
    console.error(`No --${token} in the ${theme} block; tokens.css has moved on from this script.`);
    process.exit(1);
  }
  const end = next.indexOf(';', at);
  next = next.slice(0, at) + `--${token}: ${value}` + next.slice(end);
  written += 1;
}

// ---- report ----------------------------------------------------------------

const ratios = [
  ['accent on the dark page', contrast(darkAccent, darkBg)],
  ['hover accent on the dark page', contrast(darkBright, darkBg)],
  ['ink on the dark accent', contrast(inkFor(darkAccent), darkAccent)],
  ['accent on the light page', contrast(lightAccent, lightBg)],
  ['hover accent on the light page', contrast(lightBright, lightBg)],
  ['ink on the light accent', contrast(inkFor(lightAccent), lightAccent)],
];

console.log(`${dryRun ? 'Would rewrite' : 'Rewrote'} ${written} tokens in src/styles/tokens.css.\n`);
console.log(`  dark   ${rgbToHex(darkAccent)}  hover ${rgbToHex(darkBright)}  pale ${rgbToHex(darkHigh)}`);
console.log(`  light  ${rgbToHex(lightAccent)}  hover ${rgbToHex(lightBright)}  pale ${rgbToHex(lightHigh)}\n`);
for (const [what, ratio] of ratios) {
  console.log(`  ${ratio >= FLOOR ? 'ok  ' : 'FAIL'} ${ratio.toFixed(2)}:1  ${what}`);
}
if (adjustments.length) {
  console.log('\nAdjusted to clear the floor:');
  for (const line of adjustments) console.log(`  ${line}`);
}

const failed = ratios.filter(([, ratio]) => ratio < FLOOR);
if (failed.length) {
  console.error(`\n${failed.length} pairing is below ${FLOOR}:1 and could not be fixed by lightness alone.`);
  console.error('Pick a different hue, or set these tokens by hand.');
  process.exit(1);
}

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

fs.writeFileSync(tokensPath, next);

// The landing tier's copies, in the same two colours.
let landing = fs.readFileSync(landingTokensPath, 'utf8');
const landingLight = landing.indexOf("html[data-theme='light']");
const setLanding = (token, value, theme) => {
  const at = landing.indexOf(`--${token}:`, theme === 'light' ? landingLight : 0);
  if (at === -1) return false;
  landing = landing.slice(0, at) + `--${token}: ${value}` + landing.slice(landing.indexOf(';', at));
  return true;
};
const landingWrites = [
  ['ui-ondark-accent', rgbToHex(darkAccent), 'dark'],
  ['ui-ondark-accent-rgb', channels(darkAccent), 'dark'],
  ['ui-ondark-accent-bright', rgbToHex(darkBright), 'dark'],
  ['ui-chip-accent', rgbToHex(lightAccent), 'light'],
  ['ui-chip-accent-rgb', channels(lightAccent), 'light'],
  ['ui-chip-accent-bright', rgbToHex(lightBright), 'light'],
].filter(([token, value, theme]) => setLanding(token, value, theme)).length;
fs.writeFileSync(landingTokensPath, landing);
console.log(`Rewrote ${landingWrites} accent tokens in src/styles/landing/tokens.css.`);

// Inline `code` ink is the dark theme's hover accent in BOTH themes, because
// the chip behind it is dark in both. It lives with the code surface, which
// this script did not open, so a re-brand left every inline identifier in the
// docs the template's green.
let codeSurface = fs.readFileSync(codeSurfacePath, 'utf8');
const inlineAt = codeSurface.indexOf('--ui-code-inline-fg:');
if (inlineAt === -1) {
  console.error('No --ui-code-inline-fg in src/styles/code-surface.css; it has moved on from this script.');
  process.exit(1);
}
codeSurface =
  codeSurface.slice(0, inlineAt) +
  `--ui-code-inline-fg: ${rgbToHex(darkBright)}` +
  codeSurface.slice(codeSurface.indexOf(';', inlineAt));
fs.writeFileSync(codeSurfacePath, codeSurface);
console.log('Rewrote --ui-code-inline-fg in src/styles/code-surface.css.');

console.log('\nThe wordmark gradient still ends on its third stop (--ui-brand-gradient-to);');
console.log('set that by hand if the new accent clashes with it. So does the inline-code');
console.log('ink on light chips (--ui-chip-code-fg), which is syntax colour rather than brand.');

if (!verify) {
  console.log('\nNow run: npm run build && npm run check:contrast && npm run test:a11y');
  console.log('Or re-run with --verify, which does that and steps the accent until it passes.');
  process.exit(0);
}

// ---- verify against what the browser actually paints -----------------------
//
// The arithmetic above measures the accent against the surfaces tokens.css
// declares. What a reader sees is a composite: a translucent lift over a
// panel over the page, a step lighter again than any declared value. The
// first accent this script wrote measured 4.61:1 by that arithmetic and
// rendered 3.60:1 in the docs sidebar, which the contrast sweep caught.
//
// So: build, run the real sweep, and if the accent is what fails, step it and
// go again. The sweep is the oracle; this loop only drives it.

const run = (script, args) =>
  spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

let attempt = 0;
let current = { dark: darkAccent, light: lightAccent };

while (attempt < 5) {
  attempt += 1;
  process.stdout.write(`\nAttempt ${attempt}: building...`);
  const built = run(path.join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), ['build']);
  if (built.status !== 0) {
    console.error('\nThe build failed, which is not a colour problem.');
    console.error((built.stdout ?? built.stderr ?? '').slice(-2000));
    process.exit(1);
  }
  process.stdout.write(' measuring...');
  const swept = run(path.join(root, 'scripts', 'contrast-sweep.mjs'), []);
  const report = `${swept.stdout ?? ''}${swept.stderr ?? ''}`;
  if (swept.status === 0) {
    console.log(' clear.\n');
    console.log(`Final accent: dark ${rgbToHex(current.dark)}, light ${rgbToHex(current.light)}.`);
    console.log('Every rendered text node clears the floor in both themes.');
    console.log('\nStill worth running: npm run test:a11y');
    process.exit(0);
  }

  // Which of the failures are ours? The sweep prints the colour it measured.
  const failing = [...report.matchAll(/rgb\((\d+),\s*(\d+),\s*(\d+)\) on rgb\((\d+),\s*(\d+),\s*(\d+)\)/g)];
  const ours = failing.filter((m) =>
    [current.dark, current.light].some(
      (c) => Math.abs(c[0] - +m[1]) < 2 && Math.abs(c[1] - +m[2]) < 2 && Math.abs(c[2] - +m[3]) < 2
    )
  );
  if (!ours.length) {
    console.log(' failures, but none of them the accent.\n');
    console.log(report.trim());
    console.log('\nThe tokens are written; something other than this colour needs fixing.');
    process.exit(1);
  }

  const worst = ours.reduce(
    (acc, m) => Math.min(acc, contrast([+m[1], +m[2], +m[3]], [+m[4], +m[5], +m[6]])),
    Infinity
  );
  process.stdout.write(` accent at ${worst.toFixed(2)}:1, stepping it.`);
  current = {
    dark: withLightness(current.dark, Math.min(0.94, rgbToHsl(current.dark)[2] + 0.05)),
    light: withLightness(current.light, Math.max(0.06, rgbToHsl(current.light)[2] - 0.05)),
  };
  let rewritten = fs.readFileSync(tokensPath, 'utf8');
  const set = (token, value, theme) => {
    const from = theme === 'light' ? rewritten.indexOf("html[data-theme='light']") : 0;
    const at = rewritten.indexOf(`--${token}:`, from);
    rewritten = rewritten.slice(0, at) + `--${token}: ${value}` + rewritten.slice(rewritten.indexOf(';', at));
  };
  set('ui-accent', rgbToHex(current.dark), 'dark');
  set('ui-accent-rgb', channels(current.dark), 'dark');
  set('ui-accent', rgbToHex(current.light), 'light');
  set('ui-accent-rgb', channels(current.light), 'light');
  fs.writeFileSync(tokensPath, rewritten);
}

console.error(`\nStill failing after ${attempt} attempts. This hue may not work on these surfaces.`);
process.exit(1);
