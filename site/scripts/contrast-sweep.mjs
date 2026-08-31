// Every rendered text node, against the background actually behind it.
//
//   node ./scripts/contrast-sweep.mjs
//
// As plain `node`, not `npm run check:contrast`, when running it by hand here:
// `npm run` executes inside a sandbox Chrome cannot launch from, and the
// failure is a bare "unsettled top-level await" rather than anything that
// names the cause. The npm script exists for CI, where there is no such
// sandbox. scripts/visual-snapshot.mjs carries the same caveat.
//
// This exists because axe cannot do it, and reported a clean pass while three
// separate pieces of the site were unreadable.
//
// axe-core's colour-contrast rule gives up when it cannot resolve what is
// behind the text -- a background gradient, or an ancestor with a
// pseudo-element -- and files the result under `incomplete` rather than
// `violations`. `@axe-core/cli --exit` fails on violations only. Measured on
// the landing page: 0 violations, 74 passes, and 48 incomplete nodes that were
// never checked at all. Among them was a heading at 1.03:1.
//
// The three it missed, all in the light theme:
//   - `section:nth-of-type(even)` painted `#151515` under the "Get started"
//     heading: 1.03:1, invisible.
//   - the 404 page painted `#111` under its own text: 1.06:1.
//   - the copy buttons stroked their icon `rgba(255,255,255,.34)` in both
//     themes: white on white.
//
// So this composites the stack itself -- walking up through translucent
// ancestors until it reaches an opaque one, exactly as a browser paints it --
// and compares. It is deliberately narrow: text colour against composited
// background, nothing else. axe still runs and still covers everything else.
//
// Not a replacement for scripts/design-tokens.mjs either. That compares
// DECLARED tokens and so catches a bad value before it is used anywhere; this
// compares what a page actually rendered, and so catches a good token applied
// to the wrong thing, or no token at all.

import process from 'node:process';
import { join } from 'node:path';

import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

import { discoverRoutes, startPreview, resolveChromedriverPath } from './lib/preview-server.mjs';

const host = process.env.SWEEP_HOST || '127.0.0.1';
const port = process.env.SWEEP_PORT || '4325';
const baseUrl = `http://${host}:${port}`;
const root = process.cwd();

const discovered = discoverRoutes(root);
if (!discovered) {
  console.error('No dist/ found. Run `npm run build` first — this checks the built site.');
  process.exit(1);
}
const routes = process.env.SWEEP_ROUTES
  ? process.env.SWEEP_ROUTES.split(/[\s,]+/).filter(Boolean)
  : discovered;

// 1 = light, 2 = dark. The same mechanism scripts/a11y.mjs uses, and for the
// same reason: without it the pass renders whatever the machine prefers, and
// a dark-mode workstation silently tests one theme twice.
const THEMES = [
  { name: 'light', scheme: 1 },
  { name: 'dark', scheme: 2 },
];

/** Runs in the page. Returns every text node whose contrast is below its floor. */
const COLLECT = `
  const num = (s) => { const m = String(s).match(/-?[0-9.]+/g); return m ? m.map(Number) : []; };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const over = (fg, bg) => { const a = fg.length > 3 ? fg[3] : 1;
    return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)); };

  // Walk up until an opaque background, compositing every translucent layer on
  // the way. This is the step axe skips.
  const composite = (el) => {
    let n = el, layers = [];
    while (n && n.nodeType === 1) {
      const v = num(getComputedStyle(n).backgroundColor);
      if (v.length >= 3 && (v.length < 4 || v[3] > 0)) {
        layers.unshift(v);
        if (v.length < 4 || v[3] >= 1) break;
      }
      n = n.parentElement;
    }
    let base = num(getComputedStyle(document.body).backgroundColor).slice(0, 3);
    if (base.length < 3) base = [255, 255, 255];
    for (const l of layers) base = over(l, base);
    return base;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  const findings = [];
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    // Gradient-filled text paints from background-image, not from \`color\`.
    // scripts/design-tokens.mjs checks those stops against the page instead.
    if (cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)') return;

    // Direct text only. A wrapper inherits its children's text and would be
    // reported once per ancestor for the same pixels.
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.textContent;
    text = text.trim();
    if (!text) return;

    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;

    const fg = num(cs.color);
    // Faded-in elements settle opaque; measuring them mid-transition reports a
    // ratio no reader ever sees.
    if (fg.length > 3 && fg[3] < 0.95) return;

    const bg = composite(el);
    const value = ratio(fg.slice(0, 3), bg);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const floor = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (value >= floor) return;

    const name =
      el.tagName.toLowerCase() +
      (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\\s+/)[0]
        : '');
    findings.push({
      selector: name,
      text: text.slice(0, 40),
      ratio: Math.round(value * 100) / 100,
      floor,
      fg: cs.color,
      bg: 'rgb(' + bg.map(Math.round).join(',') + ')',
    });
  });
  return findings;
`;

async function sweep(theme) {
  const options = new chrome.Options().addArguments(
    // Headless is not optional: a headed Chrome takes its colour scheme from
    // the OS and ignores the flag below.
    '--headless=new',
    '--hide-scrollbars',
    '--no-sandbox',
    '--disable-gpu',
    // Offline, so a failed GitHub fetch cannot leave half a page unrendered
    // at a moment that varies between runs.
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    `--blink-settings=preferredColorScheme=${theme.scheme}`,
  );
  const driverPath = resolveChromedriverPath(process.env.SWEEP_CHROMEDRIVER_PATH);
  const builder = new Builder().forBrowser('chrome').setChromeOptions(options);
  if (driverPath) builder.setChromeService(new chrome.ServiceBuilder(driverPath));
  const driver = await builder.build();

  const failures = [];
  try {
    for (const route of routes) {
      await driver.manage().window().setRect({ width: 1400, height: 1000 });
      await driver.get(new URL(route, baseUrl).href);
      await driver.executeScript('return document.fonts ? document.fonts.ready : true;');
      await new Promise((r) => setTimeout(r, 400));
      const found = await driver.executeScript(COLLECT);
      for (const f of found) failures.push({ ...f, route, theme: theme.name });
    }
  } finally {
    await driver.quit();
  }
  return failures;
}

const { cleanup } = await startPreview({
  baseUrl,
  host,
  port,
  astroCli: join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'),
  allowReuse: process.env.SWEEP_REUSE_SERVER === '1',
  reuseHint: 'SWEEP_REUSE_SERVER',
});

let all = [];
try {
  for (const theme of THEMES) {
    console.log(`=== ${theme.name} theme — ${routes.length} route(s) ===`);
    all = all.concat(await sweep(theme));
  }
} finally {
  cleanup();
}

if (all.length) {
  console.error(`\n✗ ${all.length} text/background pair(s) below the WCAG AA floor:\n`);
  for (const f of all) {
    console.error(
      `  ${String(f.ratio).padStart(6)} / ${f.floor}  [${f.theme}] ${f.route}\n` +
        `          ${f.fg} on ${f.bg}\n` +
        `          ${f.selector}  "${f.text}"`,
    );
  }
  console.error('\nThe background is composited from the real ancestor stack, so these are');
  console.error('what a reader sees, not what a declaration says.');
  process.exit(1);
}

console.log(
  `\n✓ Every rendered text node clears its contrast floor, across ${routes.length} route(s) in both themes.`,
);
