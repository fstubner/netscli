/**
 * Guard the shape of src/styles/docs/: one file per region of the docs
 * shell, every file registered, and no !important.
 *
 * The region files replaced a 30-file, load-order-dependent override stack
 * in which 905 declarations were !important and every one of them existed
 * only to beat another file in the same stack (Starlight's own CSS is in
 * @layer, so plain rules already outrank it). This check keeps it from
 * growing back:
 *
 *   1. Every .css file under src/styles/docs/ is listed in astro.config.mjs,
 *      and every listed file exists. An unregistered file is dead CSS that
 *      looks live; a registered file that is missing is a build error.
 *   2. No !important anywhere under src/styles/docs/, except the entries in
 *      ALLOWED below, each of which names the reason. The only reason that
 *      has ever held up is an inline `style` attribute, which no stylesheet
 *      rule can outrank otherwise.
 *
 * Load-order dependence between files is covered by css-shadowing.mjs, which
 * runs at budget 0 over the same list.
 *
 *   node scripts/css-regions.mjs
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const dir = join(root, 'src', 'styles', 'docs');

/** file -> number of !important declarations permitted, and why. */
const ALLOWED = new Map([
  [
    'code.css',
    {
      count: 5,
      reason:
        'Expressive Code sets token colours as inline style attributes (style="--0:#..."); only !important outranks an inline declaration.',
    },
  ],
]);

const config = readFileSync(join(root, 'astro.config.mjs'), 'utf8');
const registered = [...config.matchAll(/'\.\/src\/styles\/docs\/([^']+)'/g)].map((m) => m[1]);
const onDisk = readdirSync(dir).filter((f) => f.endsWith('.css'));

const problems = [];

for (const f of onDisk) {
  if (!registered.includes(f)) problems.push(`src/styles/docs/${f} exists but is not listed in astro.config.mjs customCss`);
}
for (const f of registered) {
  if (!existsSync(join(dir, f))) problems.push(`astro.config.mjs lists src/styles/docs/${f}, which does not exist`);
}

for (const f of onDisk) {
  // Strip comments before counting: the files explain !important in prose.
  const css = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const count = (css.match(/!important/g) || []).length;
  const allowed = ALLOWED.get(f);
  if (count === 0) continue;
  if (!allowed) problems.push(`src/styles/docs/${f}: ${count} !important; none allowed here`);
  else if (count !== allowed.count)
    problems.push(`src/styles/docs/${f}: ${count} !important, ${allowed.count} allowed (${allowed.reason})`);
}

if (problems.length) {
  console.error('CSS region guard failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `CSS regions OK: ${onDisk.length} files under src/styles/docs/, all registered; !important only where allowed (${[...ALLOWED.keys()].join(', ')}).`,
);
