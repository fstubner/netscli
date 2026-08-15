/**
 * Delete the declarations `css-shadowing.mjs` proves can never take effect.
 *
 * Companion to that analysis; see its header for why B-23 is being approached
 * this way rather than by rewriting the stack. Every removal here is
 * behaviour-preserving by construction: the declaration is in the same media
 * context and selector as a later one of equal-or-greater importance, so the
 * later one already wins on every element the earlier could match.
 *
 * A rule left with no declarations is removed entirely.
 *
 *   node scripts/css-prune.mjs --dry-run   # default
 *   node scripts/css-prune.mjs --write
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { analyse } from './css-shadowing.mjs';

const write = process.argv.includes('--write');
const { shadowed } = analyse();

// Group by file so each is rewritten once.
const byFile = new Map();
for (const decl of shadowed) {
  if (!byFile.has(decl.file)) byFile.set(decl.file, []);
  byFile.get(decl.file).push(decl);
}

// Tracks how far into each duplicate body we have already consumed, so two
// byte-identical rule bodies do not both resolve to the first occurrence.
const consumed = new Map();

let removedTotal = 0;
let rulesEmptied = 0;

for (const [relative, decls] of byFile) {
  const path = join(process.cwd(), relative.replace(/^\.\//, ''));
  let css = readFileSync(path, 'utf8');

  // Match on the exact declaration text so a same-property-different-value
  // declaration elsewhere in the file is never touched by accident.
  for (const decl of decls) {
    const literal = `${decl.property}: ${decl.value}`;
    // The parser normalises whitespace, so the source may wrap a value across
    // lines. Escape the value, then let any run of escaped whitespace match
    // any real whitespace run.
    const valuePattern = escapeRe(decl.value).replace(/(\\?\s)+/g, '\\s+');
    // These files are CRLF, so the trailing lookahead has to tolerate the
    // \r before the newline or nothing ever matches.
    const declPattern = `(^|\\n)[ \\t]*${escapeRe(decl.property)}\\s*:\\s*${valuePattern}\\s*;?[ \\t\\r]*(?=\\n|$)`;

    // Scope the edit to the exact rule body this declaration came from.
    //
    // Matching the declaration text file-wide was wrong and did real damage:
    // the same `property: value` pair appears in many rules, so removing the
    // first textual match deleted a declaration from an entirely different,
    // still-live rule. Verified against rendered output, that produced one
    // genuine visual regression out of 370 removals — the search dialog's
    // mobile cancel button lost its `justify-content`.
    const bodyIndex = findRuleBody(css, decl.body);
    if (bodyIndex === -1) {
      console.warn(`  ! could not locate the rule containing "${literal}" in ${relative} — left in place`);
      continue;
    }
    const head = css.slice(0, bodyIndex.start);
    const body = css.slice(bodyIndex.start, bodyIndex.end);
    const tail = css.slice(bodyIndex.end);
    const nextBody = body.replace(new RegExp(declPattern), '$1');
    if (nextBody !== body) {
      css = head + nextBody + tail;
      removedTotal += 1;
    } else {
      console.warn(`  ! could not locate "${literal}" within its rule in ${relative} — left in place`);
    }
  }

  // Drop rules that are now empty; an empty rule is noise, not behaviour.
  const emptied = css.match(/[^{}]+\{\s*\}/g);
  if (emptied) rulesEmptied += emptied.length;
  css = css.replace(/[^{}]+\{\s*\}\s*/g, '');
  css = css.replace(/\n{3,}/g, '\n\n');

  if (write) writeFileSync(path, css, 'utf8');
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locate a rule body in the source by its exact text.
 *
 * The analyser hands back the raw body it parsed, so an indexOf is enough and
 * cannot drift from what was analysed. Each body is consumed once, so two
 * rules with byte-identical bodies do not both resolve to the first.
 */
function findRuleBody(css, body) {
  const from = consumed.get(body) ?? 0;
  const start = css.indexOf(body, from);
  if (start === -1) return -1;
  consumed.set(body, start + 1);
  return { start, end: start + body.length };
}

console.log(
  `${write ? 'Removed' : 'Would remove'} ${removedTotal} shadowed declarations ` +
    `across ${byFile.size} files, emptying ${rulesEmptied} rules.`,
);
if (!write) console.log('Re-run with --write to apply.');
