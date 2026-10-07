import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE_TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The release tags GitHub lists as published, when the build was told.
 *
 *  The site deploys from main, and on main a version is bumped, tagged and
 *  dated before its release is published, so nothing in the repository says
 *  which versions are out. pages.yml asks GitHub's Releases API before the
 *  build and passes the answer in NETSCLI_PUBLISHED_RELEASES, space
 *  separated. Three cases, kept apart on purpose:
 *
 *  - unset: a local, CI or preview build, which was not told. Callers fall
 *    back to what the repository says.
 *  - set but empty: pages.yml could not ask GitHub. Callers claim nothing
 *    about releases.
 *  - a list: exactly the published releases.
 */
export function readPublishedReleases(): string[] | undefined {
  const raw = process.env.NETSCLI_PUBLISHED_RELEASES;
  if (raw === undefined) return undefined;
  return raw.split(/\s+/).filter((tag) => RELEASE_TAG.test(tag));
}

/** The version the site presents as current: the newest published release,
 *  pre-releases aside, so netscli.com never names a version nobody can
 *  install yet. 0.3.5 showed as current, in the landing page's structured
 *  data, while its release was still a draft.
 *
 *  An empty string when pages.yml could not ask GitHub, and the page then
 *  leaves the version out. Builds that were not told (unset) still read
 *  apps/netscli-gui/package.json, which is what a local preview wants. */
export function readProductVersion(): string {
  const published = readPublishedReleases();
  if (published === undefined) return readPackageVersion();
  const stable = published
    .map((tag) => STABLE_TAG.exec(tag))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const newest = stable.at(-1);
  return newest ? newest.join('.') : '';
}

function readPackageVersion(): string {
  const packagePath = [
    join(process.cwd(), '..', 'apps', 'netscli-gui', 'package.json'),
    join(process.cwd(), 'apps', 'netscli-gui', 'package.json'),
  ].find((candidate) => existsSync(candidate));
  if (!packagePath) return '0.0.0';
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
  return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
}
