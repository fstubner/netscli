/**
 * Does a CSS change render the same? A static cascade comparison.
 *
 * For every element in the built pages, every longhand property, every
 * capture width and every state, this works out which declaration wins
 * under the stylesheets at a git ref and under the working tree, and lists
 * the cells where the two disagree. It is what the screenshot check
 * (visual-snapshot.mjs) cannot see: hover and focus states, the light
 * theme's rules on something only the dark capture shows, a rule that only
 * applies at 815px.
 *
 *   node scripts/css-equivalence.mjs [--old <ref>] [--stack docs|landing]
 *   node scripts/css-equivalence.mjs capture-search
 *
 * --old defaults to origin/main. --stack picks which stylesheet list to
 * compare: `docs` is astro.config.mjs's customCss (checked against the
 * Starlight pages), `landing` is what layouts/Page.astro imports (checked
 * against the rest). Both need a current `dist/`; run `npm run build`.
 *
 * `capture-search` opens the docs search dialog in Chrome with a query and
 * saves the resulting DOM under .css-equivalence/, because Pagefind
 * renders the whole panel at runtime and the static pages never contain
 * it. Run it once after a build; the comparison picks the file up.
 *
 * What it does not model, each of which has produced a false "identical":
 *   - inline `style` attributes (Expressive Code's token colours; only
 *     !important beats them) -- the screenshots caught this;
 *   - component-scoped <style> blocks in .astro files, which the build
 *     rewrites with a per-component attribute -- covered by screenshots;
 *   - runtime state not in STATE_DIMS (lib/css-cascade.mjs) -- add the
 *     state there when a captured DOM carries it, or the check will assume
 *     it is always on.
 * It is a second check, not the only one.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import process from 'node:process';
import postcss from 'postcss';
import { parseHTML } from 'linkedom';
import { specificity, expandAlternatives, mediaMatches, contexts, applies, contextKey, structural, pseudoElement, longhands, recoverBraces, winner } from './lib/css-cascade.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OLD_REF = opt('--old', 'origin/main');
const STACK = opt('--stack', 'docs');
const WIDTHS = [1800, 1600, 1250, 1100, 900, 815, 760, 640];
const CAPTURE_DIR = join(root, '.css-equivalence');

if (args[0] === 'capture-search') { await captureSearch(); process.exit(0); }

/* ---- Stylesheet lists --------------------------------------------------- */
function sheetsFromConfig(source) {
  return [...source.matchAll(/'\.\/src\/styles\/([^']+)'/g)].map((m) => `src/styles/${m[1]}`);
}
function sheetsFromLayout(source) {
  return [...source.matchAll(/import '\.\.\/styles\/([^']+)'/g)].map((m) => `src/styles/${m[1]}`);
}
const listFile = STACK === 'landing' ? 'src/layouts/Page.astro' : 'astro.config.mjs';
const pick = STACK === 'landing' ? sheetsFromLayout : sheetsFromConfig;
const oldFiles = pick(execSync(`git show ${OLD_REF}:site/${listFile}`, { encoding: 'utf8' }));
const newFiles = pick(readFileSync(join(root, listFile), 'utf8'));
const oldStack = oldFiles.map((f) => execSync(`git show ${OLD_REF}:site/${f}`, { encoding: 'utf8', maxBuffer: 1 << 24 }));
const newStack = newFiles.map((f) => readFileSync(join(root, f), 'utf8'));

/* ---- Pages ---------------------------------------------------------------- */
const pages = [];
const walkHtml = (d) => { if (!existsSync(d)) return; for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walkHtml(f); else if (n.endsWith('.html')) pages.push(f); } };
walkHtml(join(root, 'dist'));
walkHtml(CAPTURE_DIR);
if (!pages.length) { console.error('No dist/ found. Run `npm run build` first.'); process.exit(1); }
// Starlight pages carry its header's search element; Page.astro pages (index, 404, changelog) do not.
const isDocs = (html) => html.includes('<site-search');
const docs = pages
  .map((f) => ({ f, html: readFileSync(f, 'utf8') }))
  .filter(({ html }) => (STACK === 'landing' ? !isDocs(html) : isDocs(html)))
  .map(({ f, html }) => ({ f, document: parseHTML(html).document }));

// Replay what src/scripts/docs-tables.ts does at runtime, so the wrapper
// and the marker classes exist for matching.
for (const { document } of docs) {
  const content = document.querySelector('.sl-markdown-content');
  if (!content) continue;
  const opts = { 'netscli-table: row-headers': 'table-row-headers', 'netscli-table: plain-first-column': 'table-plain-first-column' };
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 8) {
        const cls = opts[(n.nodeValue || '').trim().toLowerCase()];
        if (cls) { let sib = n.nextSibling; while (sib) { if (sib.nodeType === 1) { if (sib.tagName === 'TABLE') sib.classList.add(cls); break; } sib = sib.nextSibling; } }
      } else if (n.nodeType === 1) walk(n);
    }
  };
  walk(content);
  for (const table of content.querySelectorAll('table')) {
    if (table.parentElement && table.parentElement.classList.contains('netscli-table-scroll')) continue;
    const w = document.createElement('div'); w.className = 'netscli-table-scroll'; table.before(w); w.append(table);
  }
}

let elSeq = 0;
const elemCache = new Map();
function elems(sel) {
  const q0 = structural(sel);
  if (elemCache.has(q0)) return elemCache.get(q0);
  const set = new Set();
  for (const q of expandAlternatives(q0)) for (const { document } of docs) {
    let list = [];
    try { list = document.querySelectorAll(q || 'html'); } catch { elemCache.set(q0, null); return null; }
    for (const el of list) { if (!el.__id) el.__id = `e${elSeq++}`; set.add(el.__id); }
  }
  elemCache.set(q0, set);
  return set;
}
const subject = (sel) => sel.trim().split(/[\s>+~]+/).pop().replace(/\[[^\]]*\]/g, '').replace(/::?[a-z-]+(\([^)]*\))?/g, '');
// Selectors for DOM that only exists at runtime fall back to a name bucket.
const RUNTIME = /pagefind|dialog|site-search|feedback|aria-hidden|isMobile|sl-sidebar-state|search-offline|data-search-modal|::backdrop|data-copied|\.show|netscli-table-scroll/;

/* ---- Index a stack ------------------------------------------------------- */
function index(sources) {
  const byKey = new Map();
  let order = 0;
  const ast = postcss.parse(recoverBraces(sources.join('\n')));
  ast.walkRules((rule) => {
    const chain = [];
    let p = rule.parent;
    while (p && p.type === 'atrule') { chain.unshift(`@${p.name} ${p.params.replace(/\s+/g, ' ')}`); p = p.parent; }
    const media = chain.join(' { ');
    const sels = rule.selectors.map((s) => s.replace(/\s+/g, ' ').replace(/^html (?=[^\[])/, ''));
    rule.walkDecls((d) => {
      order++;
      for (const sel of sels) {
        const els = elems(sel);
        if (els && els.size === 0 && !RUNTIME.test(sel)) continue;
        const ids = els && els.size ? [...els] : ['~' + subject(sel)];
        const pe = pseudoElement(sel);
        const base = { media, sel, prop: d.prop, value: d.value.replace(/\s+/g, ' ').trim(), important: !!d.important, order, s: specificity(sel) };
        for (const [key, val] of longhands(d.prop, base.value)) {
          for (const id of ids) { const k = `${id}${pe}|${key}`; (byKey.get(k) || byKey.set(k, []).get(k)).push({ ...base, val }); }
        }
      }
    });
  });
  return byKey;
}

/* ---- Compare -------------------------------------------------------------- */
const I1 = index(oldStack), I2 = index(newStack);
console.log(`${STACK}: ${oldFiles.length} sheets at ${OLD_REF} vs ${newFiles.length} in the working tree, over ${docs.length} page(s)`);
const norm = (v) => v.replace(/\s+/g, ' ').replace(/(^|[^\d.])0\.(\d)/g, '$1.$2').replace(/, /g, ',').replace(/"/g, "'").trim();
const diffs = new Map();
let cells = 0;
for (const k of new Set([...I1.keys(), ...I2.keys()])) {
  const l1 = I1.get(k) || [], l2 = I2.get(k) || [];
  const ctxs = contexts([...l1, ...l2].map((x) => x.sel));
  for (const w of WIDTHS) {
    const m1 = l1.filter((x) => mediaMatches(x.media, w)), m2 = l2.filter((x) => mediaMatches(x.media, w));
    if (!m1.length && !m2.length) continue;
    for (const ctx of ctxs) {
      const a = winner(m1.filter((x) => applies(x.sel, ctx))), b = winner(m2.filter((x) => applies(x.sel, ctx)));
      const va = a ? norm(a.val) : '(none)', vb = b ? norm(b.val) : '(none)';
      if (va === vb) continue;
      cells++;
      const id = `${k.split('|')[1]}|${a ? a.sel : ''}|${va}|${b ? b.sel : ''}|${vb}`;
      if (!diffs.has(id)) diffs.set(id, { key: k.split('|')[1], w, ctx: contextKey(ctx), a, b, n: 0 });
      diffs.get(id).n++;
    }
  }
}
// A custom property nobody on these pages reads cannot render. Keep such
// diffs out of the report. A token read only by a component's scoped style
// still counts, so the components that render on this stack's pages are
// searched too: Starlight's overrides for the docs, everything else for
// the landing page.
const componentDirs = STACK === 'landing' ? ['src/components', 'src/pages', 'src/layouts'] : ['src/components/starlight'];
// The new stack's readers decide: a token only the old stack read, from a
// rule that went with it, cannot matter; one the new stack still reads and
// no longer receives is exactly what this should report.
const readers = [...newStack, ...componentDirs.flatMap((d) => readAstro(join(root, d), STACK === 'landing'))].join(String.fromCharCode(10));
const isRead = (name) => readers.includes(`var(${name}`);
for (const [id, d] of diffs) if (d.key.startsWith('--') && !isRead(d.key)) { cells -= d.n; diffs.delete(id); }
function readAstro(d, skipStarlight) { const out = []; for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) { if (!(skipStarlight && n === 'starlight')) out.push(...readAstro(f, skipStarlight)); } else if (/\.astro$/.test(n)) out.push(readFileSync(f, 'utf8')); } return out; }
const fmt = (x) => (x ? `${x.sel} {${x.prop}: ${x.value}${x.important ? ' !important' : ''}} @${x.media || 'all'}` : '(nothing)');
for (const { key, w, ctx, a, b, n } of diffs.values()) console.log(`${key} @${w}px [${ctx}] x${n}\n  OLD: ${fmt(a)}\n  NEW: ${fmt(b)}`);
if (diffs.size) { console.log(`\n${diffs.size} distinct difference(s), ${cells} cells. Each is a place the new stylesheets render differently -- or a state this model cannot see; say which.`); process.exit(1); }
console.log('Identical: the same declaration wins everywhere the model can see.');

/* ---- capture-search ------------------------------------------------------- */
async function captureSearch() {
  const { Builder } = await import('selenium-webdriver');
  const chrome = await import('selenium-webdriver/chrome.js');
  const { startPreview, resolveChromedriverPath } = await import('./lib/preview-server.mjs');
  const port = 4329, host = '127.0.0.1', baseUrl = `http://${host}:${port}`;
  const { cleanup } = await startPreview({ baseUrl, host, port, astroCli: join(root, 'node_modules/astro/bin/astro.mjs'), allowReuse: false, reuseHint: 'CSS_EQUIVALENCE_REUSE' });
  try {
    const options = new chrome.Options();
    options.addArguments('--headless=new', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--disable-gpu');
    const driverPath = resolveChromedriverPath(process.env.VISUAL_CHROMEDRIVER_PATH);
    const builder = new Builder().forBrowser('chrome').setChromeOptions(options);
    if (driverPath) builder.setChromeService(new chrome.ServiceBuilder(driverPath));
    const driver = await builder.build();
    try {
      await driver.manage().window().setRect({ width: 1600, height: 900 });
      await driver.get(`${baseUrl}/docs/`);
      await driver.executeScript(`document.querySelector('site-search button[data-open-modal]')?.click();`);
      const deadline = Date.now() + 10000;
      const until = async (js) => { let r; while (Date.now() < deadline && !(r = await driver.executeScript(js))) await new Promise((res) => setTimeout(res, 100)); return r; };
      if (!(await until(`return !!document.querySelector('site-search dialog[open] .pagefind-ui__search-input')`))) throw new Error('search dialog did not open');
      await driver.executeScript(`const i = document.querySelector('site-search dialog[open] .pagefind-ui__search-input'); i.focus(); i.value = 'scan'; i.dispatchEvent(new Event('input', { bubbles: true }));`);
      const n = await until(`return document.querySelectorAll('site-search dialog[open] .pagefind-ui__result').length`);
      if (!n) throw new Error('search returned no results');
      const html = await driver.executeScript('return document.documentElement.outerHTML');
      mkdirSync(join(CAPTURE_DIR, 'docs-search'), { recursive: true });
      writeFileSync(join(CAPTURE_DIR, 'docs-search', 'index.html'), html);
      console.log(`Saved the open search dialog (${n} results) to .css-equivalence/docs-search/index.html`);
    } finally { await driver.quit(); }
  } finally { await cleanup(); }
}
