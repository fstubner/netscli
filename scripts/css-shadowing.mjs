/**
 * Find declarations in the Starlight override stack that can never take
 * effect, because a later rule with at least equal weight always wins.
 *
 * B-23 found 28 files, ~4,900 lines and 1,200+ `!important`, with rules
 * resolved purely by load order — "no rule can be changed by editing the file
 * that appears to own it". Rewriting that by hand is how a site breaks.
 *
 * This takes the safe half first: a declaration that is *provably* shadowed
 * contributes nothing to the rendered page, so deleting it cannot change
 * behaviour. Whatever remains after that is the part that genuinely needs
 * judgement, and it is far smaller.
 *
 * Deliberately conservative. It only reports a shadow when the later
 * declaration has:
 *   - the identical selector text (normalised), and
 *   - the identical media/supports context, and
 *   - importance at least as strong,
 * so it never has to reason about whether one selector subsumes another.
 * That undercounts, which is the right direction to be wrong in.
 *
 * Usage:
 *   node scripts/css-shadowing.mjs            # report
 *   node scripts/css-shadowing.mjs --json     # machine-readable
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const CONFIG = join(process.cwd(), 'astro.config.mjs');

/** Files in the exact order Starlight loads them; order is the whole point. */
export function loadOrder() {
  const config = readFileSync(CONFIG, 'utf8');
  const block = config.match(/customCss:\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error('could not find customCss in astro.config.mjs');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Strip comments so braces inside them cannot desync the parser. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Walk rules, tracking at-rule nesting so `@media` context is part of a
 * declaration's identity. Two identical selectors in different media queries
 * are not the same rule and must not be treated as shadowing.
 */
function parseRules(css, file) {
  const rules = [];
  const context = [];
  let buffer = '';
  let i = 0;

  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const prelude = buffer.trim();
      buffer = '';
      if (prelude.startsWith('@')) {
        // At-rule with a block: push context and keep walking.
        context.push(prelude.replace(/\s+/g, ' '));
        i += 1;
        continue;
      }
      // Style rule: capture to the matching close brace.
      let depth = 1;
      let body = '';
      i += 1;
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        body += css[i];
        i += 1;
      }
      i += 1;
      rules.push({ file, context: context.join(' && '), selector: normalizeSelector(prelude), body });
      continue;
    }
    if (ch === '}') {
      context.pop();
      buffer = '';
      i += 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  return rules;
}

function normalizeSelector(selector) {
  return selector
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .sort()
    .join(', ');
}

function parseDeclarations(body) {
  const out = [];
  for (const chunk of body.split(';')) {
    const text = chunk.trim();
    if (!text) continue;
    const colon = text.indexOf(':');
    if (colon < 1) continue;
    const property = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (!property || property.startsWith('--')) continue;
    out.push({ property, value, important: /!important\s*$/i.test(value) });
  }
  return out;
}

export function analyse() {
  const files = loadOrder();
  const declarations = [];

  files.forEach((relative, fileIndex) => {
    const path = join(process.cwd(), relative.replace(/^\.\//, ''));
    const css = stripComments(readFileSync(path, 'utf8'));
    for (const rule of parseRules(css, relative)) {
      for (const decl of parseDeclarations(rule.body)) {
        declarations.push({ ...decl, ...rule, fileIndex });
      }
    }
  });

  // Last write wins for an identical (context, selector, property) triple.
  const winners = new Map();
  for (const d of declarations) {
    const key = `${d.context}|${d.selector}|${d.property}`;
    const current = winners.get(key);
    if (!current) {
      winners.set(key, d);
      continue;
    }
    // A later declaration wins unless it is weaker in importance.
    if (d.important || !current.important) winners.set(key, d);
  }

  const shadowed = declarations.filter((d) => {
    const key = `${d.context}|${d.selector}|${d.property}`;
    const winner = winners.get(key);
    if (winner === d) return false;
    // Only call it dead when the winner is at least as strong AND later.
    if (winner.fileIndex < d.fileIndex) return false;
    if (d.important && !winner.important) return false;
    return true;
  });

  return { files, declarations, shadowed, winners };
}

// Only report when run directly; css-prune.mjs imports `analyse` and should
// not trigger a second report as a side effect of the import.
const runDirectly = process.argv[1] && process.argv[1].endsWith('css-shadowing.mjs');
const { files, declarations, shadowed } = runDirectly
  ? analyse()
  : { files: [], declarations: [], shadowed: [] };

if (!runDirectly) {
  // no-op
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: declarations.length, shadowed }, null, 2));
} else {
  const byFile = new Map();
  for (const d of shadowed) byFile.set(d.file, (byFile.get(d.file) ?? 0) + 1);

  console.log(`${files.length} stylesheets, ${declarations.length} declarations.`);
  console.log(`${shadowed.length} are provably shadowed by a later rule of equal-or-greater weight.\n`);
  for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${file.replace('./src/styles/starlight/', '')}`);
  }
}
