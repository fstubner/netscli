/* The one-line, human-written summary of a release, from the site's content.
 *
 * Two readers: scripts/release-notes.mjs puts it at the top of the GitHub
 * release body, and scripts/release/updater-manifest.mjs puts it in
 * latest.json, where the desktop app shows it in the update dialog.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The summaries live in a .ts the site authors, and it imports from
 * './meta' without an extension -- Astro resolves that, node does not, so
 * the module cannot simply be imported. The export is an object of string
 * literals, so the literal is evaluated on its own instead. A shape change
 * throws here rather than quietly producing no summary. */
export function releaseSummary(wantedTag) {
  const file = join(root, 'site', 'src', 'data', 'site-content', 'changelog.ts');
  const source = readFileSync(file, 'utf8');
  const marker = 'export const releaseSummaries';
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`no ${marker} in ${file}`);
  const open = source.indexOf('{', at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error(`unterminated releaseSummaries object in ${file}`);
  // Our own source, read from disk at publish time, not input from anywhere.
  const summaries = new Function(`return ${source.slice(open, close + 1)}`)();
  return summaries[wantedTag] ?? null;
}
