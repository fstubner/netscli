export interface LatestReleaseInfo {
  version: string;
  url: string;
  name?: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  name?: string;
}

const LATEST_RELEASE_URL = 'https://api.github.com/repos/fstubner/netscli/releases/latest';

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '').split(/[+-]/)[0];
}

export function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<LatestReleaseInfo> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Release check failed: ${response.status}`);
  }

  const payload = (await response.json()) as GitHubReleaseResponse;
  if (!payload.tag_name || !payload.html_url) {
    throw new Error('Release check returned an unexpected response');
  }

  return {
    version: normalizeVersion(payload.tag_name),
    url: payload.html_url,
    name: payload.name,
  };
}
