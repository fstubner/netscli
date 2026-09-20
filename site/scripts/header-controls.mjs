/* Are the docs header's controls where a reader can reach them, at every
 * width the site is used at?
 *
 * Both of the failures this checks for shipped, and neither was visible to
 * anything already in CI. The header renders, every element is in the DOM,
 * axe is happy because nothing is unlabelled, the contrast sweep is happy
 * because every colour pair passes, and Lighthouse is happy because the page
 * is fast. What was wrong was where things sat, and at which widths.
 *
 * 1. The search control was stranded. `Header.astro` moved the width at which
 *    the nav links hide from 900px to 72rem, and the rule in header.css that
 *    compensates by handing the layout seam to search was left at 900px. From
 *    901px to 1152px the seam sat on an element with `display: none`, which
 *    takes no part in flex layout, so search came to rest beside the wordmark
 *    with up to 861px of empty bar to its right.
 *
 * 2. The theme control was unreachable. It was hidden at 72rem on the
 *    understanding that the mobile menu's footer carried it from there down.
 *    That footer only opens from Starlight's `.sl-menu-button`, which is
 *    `md:sl-hidden` and appears below 50rem, so between 800px and 1152px the
 *    site had no theme switch at all.
 *
 * Both are the same shape: a breakpoint moved and the thing depending on it
 * did not. This asserts the outcome rather than the breakpoints, so it keeps
 * working when the numbers change again.
 *
 *   node ./scripts/header-controls.mjs
 */

import { join } from 'node:path';
import process from 'node:process';
import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { startPreview, resolveChromedriverPath } from './lib/preview-server.mjs';

const root = process.cwd();
const host = '127.0.0.1';
const port = Number(process.env.HEADER_CHECK_PORT || 4326);
const baseUrl = `http://${host}:${port}`;
const ROUTE = '/docs/';

/* Deliberately dense around the two breakpoints that carry the layout (50rem
 * and 72rem), and either side of the 900px that used to. A sparse list is how
 * a band this wide went unnoticed. */
const WIDTHS = [1440, 1280, 1200, 1160, 1152, 1140, 1100, 1000, 950, 901, 900, 860, 820, 801, 799, 700, 600];

/* The search control is an icon in the collapsed band. Anything much beyond a
 * normal flex gap between it and the next control to its right means the seam
 * has gone and it is floating in open bar. The failure being guarded against
 * measured 621-861px, so this has a wide margin and still catches it. */
const MAX_TRAILING_GAP = 120;

const PROBE = `
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    let node = el;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return { hidden: true };
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { hidden: true };
    return { left: r.left, right: r.right };
  };
  const anyThemeVisible = [...document.querySelectorAll('.ui-theme-select, starlight-theme-select')]
    .some((el) => {
      let n = el;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        n = n.parentElement;
      }
      return el.getBoundingClientRect().width > 0;
    });
  return {
    vw: window.innerWidth,
    bar: box('.docs-topbar'),
    search: box('.docs-header-search'),
    links: box('.docs-nav-links'),
    theme: box('.docs-header-theme'),
    menuButton: box('.sl-menu-button'),
    anyThemeVisible,
  };
`;

const { cleanup } = await startPreview({
  baseUrl,
  host,
  port,
  astroCli: join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'),
  allowReuse: process.env.HEADER_CHECK_REUSE_SERVER === '1',
  reuseHint: 'HEADER_CHECK_REUSE_SERVER',
});

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options().addArguments('--headless=new', '--disable-gpu', '--no-sandbox'),
  )
  .setChromeService(new chrome.ServiceBuilder(resolveChromedriverPath(process.env.HEADER_CHECK_CHROMEDRIVER_PATH)))
  .build();

const failures = [];

try {
  await driver.get(`${baseUrl}${ROUTE}`);
  for (const width of WIDTHS) {
    await driver.manage().window().setRect({ width, height: 900 });
    // Give the media queries a frame to settle before measuring.
    await new Promise((r) => setTimeout(r, 200));
    const m = await driver.executeScript(PROBE);

    if (!m.search || m.search.hidden) {
      failures.push(`${m.vw}px: no visible search control in the docs header`);
    } else {
      // The nearest thing to the right of search, or the bar's own edge.
      const neighbours = [m.links, m.theme, m.menuButton]
        .filter((b) => b && !b.hidden && b.left >= m.search.right)
        .map((b) => b.left);
      const rightOf = neighbours.length ? Math.min(...neighbours) : m.bar?.right;
      if (rightOf !== undefined) {
        const gap = Math.round(rightOf - m.search.right);
        if (gap > MAX_TRAILING_GAP) {
          failures.push(
            `${m.vw}px: ${gap}px of empty bar after the search control ` +
              `(max ${MAX_TRAILING_GAP}px) — the layout seam is on a hidden element`,
          );
        }
      }
    }

    /* Below 50rem the theme control and the site links live in the mobile
     * menu, which is shut, so "not visible" is correct there as long as the
     * button that opens it is. Above it, the header has to carry both. */
    const menuAvailable = m.menuButton && !m.menuButton.hidden;
    if (!m.anyThemeVisible && !menuAvailable) {
      failures.push(
        `${m.vw}px: no theme control on screen and no menu button to reach one`,
      );
    }

    /* The links go with the theme control, and for the same reason. They are
     * Features, Install, FAQ, Docs, Changelog and GitHub; the docs sidebar
     * lists the pages of the docs and carries five of those six nowhere, so
     * it is not a substitute. This check was written without this assertion
     * and the first fix for the theme control left the links hidden across
     * the same band, which is the failure it now pins. */
    if ((!m.links || m.links.hidden) && !menuAvailable) {
      failures.push(
        `${m.vw}px: no site navigation on screen and no menu button to reach it`,
      );
    }
  }
} finally {
  await driver.quit();
  cleanup();
}

if (failures.length) {
  console.error(`\n✗ docs header controls unreachable at ${failures.length} width(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ docs header controls reachable at all ${WIDTHS.length} widths checked`);
