/* The pieces of the CSS cascade that css-equivalence.mjs needs to decide,
 * for one element and one property, which declaration wins.
 *
 * This is a model, not a browser. What it covers: specificity (including
 * :is/:not/:has/:where), !important, source order, width media queries,
 * shorthands against their longhands, and the states a selector can
 * depend on (theme, hover, focus, aria-current, open, and a few of this
 * site's runtime classes). What it does not: inline `style` attributes,
 * cascade layers, inheritance, or any state not listed in STATE_DIMS. Each
 * of those has produced a false "identical" once; see the notes in
 * css-equivalence.mjs.
 */

/** Specificity packed as a*10000 + b*100 + c. */
export function specificity(sel) {
  let a = 0, b = 0, c = 0, rest = sel;
  const fn = /:(is|not|has|where)\(/g;
  let m;
  while ((m = fn.exec(rest))) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    while (i < rest.length && depth) { if (rest[i] === '(') depth++; else if (rest[i] === ')') depth--; i++; }
    const inner = rest.slice(start, i - 1);
    if (m[1] !== 'where') {
      const best = Math.max(...splitTop(inner).map(specificity));
      a += Math.floor(best / 10000); b += Math.floor(best / 100) % 100; c += best % 100;
    }
    rest = rest.slice(0, m.index) + ' ' + rest.slice(i);
    fn.lastIndex = m.index;
  }
  rest = rest.replace(/::?[a-z-]+(\([^)]*\))?/g, (x) => { if (/^::|^:(before|after)/.test(x)) c++; else b++; return ' '; });
  a += (rest.match(/#[\w-]+/g) || []).length;
  b += (rest.match(/\.[\w-]+|\[[^\]]*\]/g) || []).length;
  c += (rest.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return a * 10000 + b * 100 + c;
}

/** Split on top-level commas only. */
export function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Expand :is(a, b) / :where(a, b) into plain alternatives. */
export function expandAlternatives(q) {
  const m = /:(is|where)\(/.exec(q);
  if (!m) return [q];
  let depth = 1, i = m.index + m[0].length;
  const start = i;
  while (i < q.length && depth) { if (q[i] === '(') depth++; else if (q[i] === ')') depth--; i++; }
  const inner = q.slice(start, i - 1), before = q.slice(0, m.index), after = q.slice(i);
  return splitTop(inner).flatMap((p) => expandAlternatives(before + p + after));
}

/** Does a chain of @media params apply at a viewport `w` px wide? */
export function mediaMatches(media, w) {
  if (!media) return true;
  for (const q of media.split(' { ')) {
    if (/prefers-reduced-motion/.test(q)) return false;
    for (const m of q.matchAll(/\((min|max)-width:\s*([\d.]+)(px|rem|em)\)/g)) {
      const v = parseFloat(m[2]) * (m[3] === 'px' ? 1 : 16);
      if (m[1] === 'min' && w < v) return false;
      if (m[1] === 'max' && w > v) return false;
    }
  }
  return true;
}

/* ---- States ------------------------------------------------------------
 * A selector "applies" in a context only if every state it names is on.
 * Each dimension: the regex that means a selector depends on it, and the
 * test for whether it applies in a given context value. */
export const STATE_DIMS = [
  { key: 'theme', values: ['light', 'dark'], mentions: /data-theme=/, applies: (sel, v) => !(/data-theme='light'/.test(sel) && v !== 'light') && !(/data-theme='dark'/.test(sel) && v !== 'dark') },
  { key: 'scrolled', values: [false, true], mentions: /data-docs-scrolled/, applies: (sel, v) => !(/\[data-docs-scrolled='true'\]/.test(sel) && !/:not\(\[data-docs-scrolled/.test(sel) && !v) && !(/:not\(\[data-docs-scrolled='true'\]\)/.test(sel) && v) },
  { key: 'state', values: ['none', 'hover', 'focus-visible'], mentions: /:hover|:focus/, applies: (sel, v) => !(/:hover/.test(sel) && v !== 'hover') && !(/:focus-visible|:focus-within|:focus(?!-)/.test(sel) && v !== 'focus-visible') },
  { key: 'current', values: [false, true], mentions: /aria-current/, applies: (sel, v) => !(/\[aria-current/.test(sel) && !v) },
  { key: 'expanded', values: [false, true], mentions: /aria-expanded|\[open\]/, applies: (sel, v) => !(/\[aria-expanded='true'\]|\[open\]/.test(sel) && !v) },
  { key: 'copied', values: [false, true], mentions: /data-copied|feedback\.show/, applies: (sel, v) => !(/\[data-copied\]|feedback\.show/.test(sel) && !v) },
  { key: 'overflow', values: [false, true], mentions: /ui-search-overflow/, applies: (sel, v) => !(/ui-search-overflow/.test(sel) && !v) },
];

/** Every combination of the dimensions some selector in `sels` depends on. */
export function contexts(sels) {
  const joined = sels.join('\n');
  let out = [{}];
  for (const dim of STATE_DIMS) {
    const values = dim.mentions.test(joined) ? dim.values : [dim.values[0]];
    out = out.flatMap((ctx) => values.map((v) => ({ ...ctx, [dim.key]: v })));
  }
  return out;
}

export const applies = (sel, ctx) => expandAlternatives(sel).some((v) => STATE_DIMS.every((d) => d.applies(v, ctx[d.key])));
export const contextKey = (ctx) => STATE_DIMS.map((d) => `${ctx[d.key]}`).join('|');

/** The selector with state and scope stripped, for matching it statically. */
export function structural(sel) {
  return sel
    .replace(/^html(\[[^\]]*\]|:[a-z-]+(\([^)]*\))?)*\s+/, '')
    .replace(/:(hover|focus-visible|focus-within|focus|active|visited|target)(?![a-z-])/g, '')
    .replace(/::?(before|after|placeholder|backdrop|marker|selection|-webkit-[a-z-]+)(?![a-z-])/g, '')
    .replace(/\[aria-current(=[^\]]*)?\]|\[aria-expanded=[^\]]*\]|\[open\]|\[data-search-modal-open\]|\[data-copied\]/g, '')
    .replace(/:has\(\.feedback\.show\)/g, '')
    .replace(/\.ui-search-overflow-(top|bottom)/g, '')
    .replace(/^html(\[[^\]]*\])*$/, 'html')
    .trim();
}

export const pseudoElement = (sel) => (sel.match(/::[a-z-]+|:(before|after|placeholder|backdrop|marker)(?![a-z-])/g) || []).join('');

/* ---- Longhands ---------------------------------------------------------
 * Shorthands collide with their longhands in the cascade, so every
 * declaration is compared on physical (LTR) longhand keys. */
const SIDES = ['top', 'right', 'bottom', 'left'];
const split = (v) => v.trim().split(/\s+(?![^(]*\))/);
const box = (v) => { const [t, r = t, b = t, l = r] = split(v); return [t, r, b, l]; };
const two = (v) => { const p = split(v); return [p[0], p[1] === undefined ? p[0] : p[1]]; };
function borderParts(v) {
  let w = 'medium', st = 'none', c = 'currentcolor';
  const toks = split(v);
  for (const t of toks) {
    if (/^(\d|\.\d|-\d|thin$|medium$|thick$)/.test(t)) w = t;
    else if (/^(none|solid|dashed|dotted|double|hidden|groove|ridge|inset|outset)$/.test(t)) st = t;
    else c = t;
  }
  if (toks.length === 1 && toks[0] === '0') { w = '0'; st = 'none'; }
  return { w, st, c };
}
const bside = (x, v) => { const { w, st, c } = borderParts(v); return [[`border-${x}-width`, w], [`border-${x}-style`, st], [`border-${x}-color`, c]]; };

export function longhands(prop, value) {
  switch (prop) {
    case 'padding': case 'margin': { const v = box(value); return SIDES.map((s, i) => [`${prop}-${s}`, v[i]]); }
    case 'inset': { const v = box(value); return SIDES.map((s, i) => [s, v[i]]); }
    case 'padding-inline': case 'margin-inline': { const [a, b] = two(value); const n = prop.replace('-inline', ''); return [[`${n}-left`, a], [`${n}-right`, b]]; }
    case 'inset-inline': { const [a, b] = two(value); return [['left', a], ['right', b]]; }
    case 'padding-block': case 'margin-block': { const [a, b] = two(value); const n = prop.replace('-block', ''); return [[`${n}-top`, a], [`${n}-bottom`, b]]; }
    case 'inset-block': { const [a, b] = two(value); return [['top', a], ['bottom', b]]; }
    case 'padding-inline-start': case 'margin-inline-start': return [[prop.replace('-inline-start', '-left'), value]];
    case 'padding-inline-end': case 'margin-inline-end': return [[prop.replace('-inline-end', '-right'), value]];
    case 'padding-block-start': case 'margin-block-start': return [[prop.replace('-block-start', '-top'), value]];
    case 'padding-block-end': case 'margin-block-end': return [[prop.replace('-block-end', '-bottom'), value]];
    case 'inset-inline-start': return [['left', value]];
    case 'inset-inline-end': return [['right', value]];
    case 'inset-block-start': return [['top', value]];
    case 'inset-block-end': return [['bottom', value]];
    case 'border': return SIDES.flatMap((s) => bside(s, value));
    case 'border-inline': return ['left', 'right'].flatMap((s) => bside(s, value));
    case 'border-block': return ['top', 'bottom'].flatMap((s) => bside(s, value));
    case 'border-inline-start': return bside('left', value);
    case 'border-inline-end': return bside('right', value);
    case 'border-inline-start-color': return [['border-left-color', value]];
    case 'border-inline-end-color': return [['border-right-color', value]];
    case 'border-inline-start-width': return [['border-left-width', value]];
    case 'border-color': return SIDES.map((s) => [`border-${s}-color`, value]);
    case 'border-width': return SIDES.map((s) => [`border-${s}-width`, value]);
    case 'border-radius': return ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => [`border-${c}-radius`, value]);
    case 'background': return [['background-color', value], ['background-image', value]];
    case 'overflow': return [['overflow-x', value], ['overflow-y', value]];
    case 'gap': return [['row-gap', value], ['column-gap', value]];
    case 'flex': return [['flex-grow', value], ['flex-shrink', value], ['flex-basis', value]];
    case 'outline': { const { w, st, c } = borderParts(value); return [['outline-width', w], ['outline-style', st], ['outline-color', c]]; }
    default:
      for (const s of SIDES) if (prop === `border-${s}`) return bside(s, value);
      return [[prop, value]];
  }
}

/** Browser-style recovery for a concatenated stack: drop stray `}`, close what is open. */
export function recoverBraces(css) {
  let depth = 0, out = '', inComment = false;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (inComment) { out += ch; if (ch === '/' && css[i - 1] === '*') inComment = false; continue; }
    if (ch === '/' && css[i + 1] === '*') { inComment = true; out += ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { if (depth === 0) continue; depth--; }
    out += ch;
  }
  return out + '}'.repeat(depth);
}

/** Pick the winning declaration: !important, then specificity, then order. */
export function winner(list) {
  let best = null;
  for (const x of list) {
    if (!best || x.important - best.important > 0 || (x.important === best.important && (x.s - best.s > 0 || (x.s === best.s && x.order > best.order)))) best = x;
  }
  return best;
}
