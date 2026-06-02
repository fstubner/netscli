import { openUrl } from '@tauri-apps/plugin-opener';

const ALLOWED_EXTERNAL_URLS = [
  'https://github.com/fstubner/netscli',
  'https://github.com/fstubner/netscli/',
];

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      (parsed.pathname === '/fstubner/netscli' ||
        parsed.pathname === '/fstubner/netscli/' ||
        parsed.pathname.startsWith('/fstubner/netscli/')) &&
      ALLOWED_EXTERNAL_URLS.some((base) => url.startsWith(base))
    );
  } catch {
    return false;
  }
}

export async function openAllowedExternalUrl(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('External URL is not allowed');
  }

  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
