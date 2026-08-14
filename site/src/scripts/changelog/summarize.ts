import type { ChangelogRelease } from './types';

export function normalizeMarkdown(markdown: string | undefined): string {
  return (markdown || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n');
}

export function normalizeTag(value: string | undefined): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.startsWith('v') ? text : `v${text}`;
}

export function isBodyBoundary(line: string): boolean {
  return (
    line.startsWith('#') ||
    line.startsWith('```') ||
    line.startsWith('>') ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^[-\s]*full changelog:/i.test(line)
  );
}

export function isGeneratedReleaseBoilerplate(line: string, release: ChangelogRelease): boolean {
  const text = line.trim();
  const normalized = text
    .replace(/^[-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (normalized === '---') return true;
  if (normalized.startsWith('full changelog:')) return true;
  if (normalized.startsWith("what's new in ")) {
    const tag = normalizeTag(release?.tag_name || release?.name).toLowerCase();
    return !tag || normalized.includes(tag.replace(/^v/, ''));
  }
  return false;
}

function sectionLabel(heading: string): string {
  const normalized = heading
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .trim();
  if (normalized.startsWith('added')) return 'additions';
  if (normalized.startsWith('fixed')) return 'fixes';
  if (normalized.startsWith('security')) return 'security updates';
  if (normalized.startsWith('changed internal')) return 'internal changes';
  if (normalized.startsWith('changed')) return 'changes';
  if (normalized.startsWith('removed')) return 'removals';
  if (normalized.startsWith('notes')) return 'release notes';
  return normalized || 'updates';
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

export function summarizeRelease(
  release: ChangelogRelease,
  markdown: string,
  releaseSummaries: Record<string, string>
): string {
  const curated = release.summary || releaseSummaries[normalizeTag(release.tag_name || release.name)];
  if (curated) return curated;

  const tag = release.tag_name || release.name || 'This release';
  const lines = normalizeMarkdown(markdown)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isGeneratedReleaseBoilerplate(line, release));

  for (let index = 0; index < lines.length; index += 1) {
    if (isBodyBoundary(lines[index])) {
      continue;
    }

    const paragraph = [];
    while (index < lines.length && !isBodyBoundary(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }

    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }

  const bodyText = lines
    .filter((line) => !line.startsWith('```') && !/full changelog/i.test(line))
    .join(' ')
    .toLowerCase();
  const sections = lines
    .map((line) => line.match(/^###\s+(.+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(sectionLabel);
  const categories = (
    [
      [/feat|feature|add|new capability|capability/, 'new capabilities'],
      [/fix|bug|repair|regression/, 'fixes'],
      [/refactor|split|decompose|extract|rename/, 'refactors'],
      [/doc|readme|site|changelog/, 'documentation'],
      [/ci|workflow|runner|release/, 'release workflow'],
      [/deps?|dependency|bump/, 'dependency maintenance'],
    ] as const
  )
    .filter(([pattern]) => pattern.test(bodyText))
    .map(([, label]) => label);
  const surfaces = (
    [
      [/gui|desktop|tauri|react/, 'desktop app'],
      [/\bcli\b|command|subcommand/, 'CLI'],
      [/\btui\b|terminal/, 'terminal UI'],
      [/\bmcp\b|agent/, 'MCP server'],
      [/core|library|crate|rust/, 'Rust core'],
      [/docs?|site|changelog/, 'docs site'],
    ] as const
  )
    .filter(([pattern]) => pattern.test(bodyText))
    .map(([, label]) => label);

  const focus = sections.length
    ? formatList([...new Set(sections)].slice(0, 3))
    : categories.length
      ? formatList([...new Set(categories)].slice(0, 3))
      : 'project updates';
  const surfaceText = surfaces.length ? ` across ${formatList([...new Set(surfaces)].slice(0, 4))}` : '';
  return `${tag} includes ${focus}${surfaceText}.`;
}
