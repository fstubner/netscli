import fs from 'node:fs';
import path from 'node:path';

/**
 * /install.sh — the repo's own scripts/install.sh, served from this domain.
 *
 * Read at build time rather than copied into public/, so there is exactly one
 * install script in this repository. A copy under public/ would be a second
 * one, and the two would differ the first time anybody edited the real one.
 *
 * This is what `curl -fsSL https://netscli.com/install.sh | bash` fetches. If
 * the file ever moves, this build fails rather than publishing an empty or
 * stale script to a URL people are told to pipe into a shell.
 */
export async function GET() {
  const source = path.join(process.cwd(), '..', 'scripts', 'install.sh');
  const body = fs.readFileSync(source, 'utf8');
  if (!body.trim()) throw new Error(`${source} is empty; refusing to publish it.`);
  return new Response(body, {
    headers: {
      // This header does not reach the live site. The build writes the body to
      // dist/install.sh and GitHub Pages picks the type from the file extension.
      // Checked 2026-10-07: /install.sh is served as application/x-sh and
      // /install.ps1 as application/octet-stream.
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
