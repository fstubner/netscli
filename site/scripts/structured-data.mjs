// Is the structured data on every built page something Google accepts?
//
// JSON-LD renders as nothing. A breadcrumb with a nameless, URL-less middle
// step shipped on every docs page and was only noticed when Search Console
// raised it as a critical issue: Missing field "item" (in "itemListElement").
// This reads the built HTML and checks the rules that would have caught it.
// Run after `astro build`.
//
//   node ./scripts/structured-data.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!fs.existsSync(dist)) {
  console.error(`No build at ${dist}. Run \`npm run build\` first.`);
  process.exit(1);
}

const pages = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) pages.push(full);
  }
};
walk(dist);

const problems = [];
let blocks = 0;
let breadcrumbs = 0;

// Google's rules for a BreadcrumbList: at least one ListItem, positions
// counting up from 1, a name on each, and an `item` URL on each (Google
// excuses the last; this does not, since the last is the page itself and
// always has one). Repeating a URL is a step that goes nowhere.
function checkBreadcrumb(list, where) {
  breadcrumbs += 1;
  const items = list.itemListElement;
  if (!Array.isArray(items) || items.length === 0) {
    problems.push(`${where}: BreadcrumbList has no itemListElement`);
    return;
  }
  const seen = new Set();
  items.forEach((step, index) => {
    const at = `${where}: breadcrumb step ${index + 1}`;
    if (step.position !== index + 1) problems.push(`${at} has position ${step.position}`);
    if (!step.name) problems.push(`${at} has no name`);
    if (!step.item) problems.push(`${at} ("${step.name}") has no item URL`);
    else if (seen.has(step.item)) problems.push(`${at} repeats ${step.item}`);
    else seen.add(step.item);
  });
}

function visit(node, where) {
  if (Array.isArray(node)) return node.forEach((child) => visit(child, where));
  if (!node || typeof node !== 'object') return;
  if (node['@type'] === 'BreadcrumbList') checkBreadcrumb(node, where);
  for (const value of Object.values(node)) visit(value, where);
}

const ldPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
for (const page of pages) {
  const where = path.relative(dist, page).replaceAll('\\', '/');
  const html = fs.readFileSync(page, 'utf8');
  for (const match of html.matchAll(ldPattern)) {
    blocks += 1;
    try {
      visit(JSON.parse(match[1]), where);
    } catch (error) {
      problems.push(`${where}: JSON-LD does not parse (${error.message})`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} structured-data problem(s).`);
  process.exit(1);
}
console.log(
  `Structured data OK: ${blocks} JSON-LD block(s) on ${pages.length} page(s), ${breadcrumbs} breadcrumb list(s).`,
);
