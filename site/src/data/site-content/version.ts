import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read the shipped product version from the GUI package.json so the site
 *  never needs a manual version bump of its own. */
export function readProductVersion(): string {
  const packagePath = [
    join(process.cwd(), '..', 'apps', 'netscli-gui', 'package.json'),
    join(process.cwd(), 'apps', 'netscli-gui', 'package.json'),
  ].find((candidate) => existsSync(candidate));
  if (!packagePath) return '0.0.0';
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
  return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
}
