import fs from 'node:fs';
import path from 'node:path';

/**
 * /install.ps1 — the repo's own scripts/install.ps1, served from this domain.
 *
 * Same reasoning as install.sh.ts: read at build time so there is one script,
 * not a copy under public/ that drifts from it.
 *
 * This is what `iwr -useb https://netscli.com/install.ps1 | iex` fetches.
 */
export async function GET() {
  const source = path.join(process.cwd(), '..', 'scripts', 'install.ps1');
  const body = fs.readFileSync(source, 'utf8');
  if (!body.trim()) throw new Error(`${source} is empty; refusing to publish it.`);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
