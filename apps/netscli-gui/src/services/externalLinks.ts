import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Where the app is allowed to send a browser: its own documentation site, and
 * its own repository. Nothing else, and https only.
 *
 * Kept in step with `src-tauri/capabilities/main.json`, which enforces the same
 * list one layer down -- this check is the readable one, that one is the one an
 * attacker has to get past.
 */
const ALLOWED_EXTERNAL_HOSTS: Record<string, (pathname: string) => boolean> = {
  'netscli.com': () => true,
  'github.com': (pathname) =>
    pathname === '/fstubner/netscli' ||
    pathname === '/fstubner/netscli/' ||
    pathname.startsWith('/fstubner/netscli/'),
};

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const allows = ALLOWED_EXTERNAL_HOSTS[parsed.hostname];
    return allows ? allows(parsed.pathname) : false;
  } catch {
    return false;
  }
}

export async function openAllowedExternalUrl(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('External URL is not allowed');
  }

  // No `window.open` fallback. It opens nothing in a Tauri window and throws
  // nothing, which is exactly how "Open setup docs" came to look inert: the
  // capability allowed the bare repository URL and `netscli/*`, the button asks
  // for `netscli#packet-capture`, that matched neither, and the refusal was
  // swallowed here.
  //
  // The rejection is left to propagate rather than rewrapped: what the user
  // should be told depends on which control they pressed, and only the caller
  // knows that.
  await openUrl(url);
}
