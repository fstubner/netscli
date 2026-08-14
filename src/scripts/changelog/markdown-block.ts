import { appendInline, el } from './markdown-inline';
import { isGeneratedReleaseBoilerplate, normalizeMarkdown, summarizeRelease } from './summarize';
import type { ChangelogRelease, ListItem } from './types';

function isDuplicateReleaseHeading(text: string, release: ChangelogRelease): boolean {
  const normalize = (value: string | undefined) =>
    String(value || '')
      .toLowerCase()
      .replace(/^#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.:]+$/, '');
  const heading = normalize(text);
  return [release.name, release.tag_name].some((value) => heading && heading === normalize(value));
}

function normalizeReleaseHeading(text: string): string {
  const value = String(text || '').trim();
  if (/^notes(?:\s+on\s+v?\d+(?:\.\d+)*(?:\S*)?)?$/i.test(value)) return 'Notes';
  return value;
}

function addParagraph(
  root: HTMLElement,
  lines: string[],
  repo: string,
  transform?: (text: string) => string
): void {
  const rawText = lines.join(' ');
  const text = (transform ? transform(rawText) : rawText).replace(/\s+/g, ' ').trim();
  if (!text) return;
  const paragraph = el('p', 'release-paragraph');
  appendInline(paragraph, text, repo);
  root.append(paragraph);
}

function addList(root: HTMLElement, items: (string | ListItem)[], ordered: boolean, repo: string): void {
  const list = document.createElement(ordered ? 'ol' : 'ul');
  list.className = 'release-note-list';
  for (const entry of items) {
    const listItem = el('li', '');
    const text = typeof entry === 'string' ? entry : entry.text;
    appendInline(listItem, text, repo);
    if (typeof entry !== 'string' && entry.children?.length) {
      addList(listItem, entry.children, false, repo);
    }
    list.append(listItem);
  }
  root.append(list);
}

function listMarker(line: string, ordered: boolean): { indent: number; text: string } | null {
  const match = line.match(ordered ? /^(\s*)\d+\.\s+(.+)$/ : /^(\s*)[-*]\s+(.+)$/);
  return match ? { indent: match[1].length, text: match[2].trim() } : null;
}

function anyListMarker(line: string) {
  const unordered = listMarker(line, false);
  return unordered || listMarker(line, true);
}

function endsListBlock(line: string, release: ChangelogRelease): boolean {
  const trimmed = line.trim();
  return (
    !trimmed ||
    isGeneratedReleaseBoilerplate(trimmed, release) ||
    trimmed.startsWith('```') ||
    /^(#{1,4})\s+/.test(trimmed) ||
    trimmed.startsWith('>')
  );
}

function collectList(
  lines: string[],
  start: number,
  ordered: boolean,
  release: ChangelogRelease
): { items: ListItem[]; nextIndex: number } {
  const first = listMarker(lines[start], ordered);
  const baseIndent = first?.indent ?? 0;
  const items: ListItem[] = [];
  let current: ListItem | null = null;
  let currentChild: ListItem | null = null;
  let index = start;

  while (index < lines.length) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (endsListBlock(raw, release)) break;

    const marker = listMarker(raw, ordered);
    const nestedMarker = anyListMarker(raw);

    if (marker && marker.indent === baseIndent) {
      current = { text: marker.text, children: [] };
      currentChild = null;
      items.push(current);
      index += 1;
      continue;
    }

    if (nestedMarker && current && nestedMarker.indent > baseIndent) {
      currentChild = { text: nestedMarker.text, children: [] };
      current.children.push(currentChild);
      index += 1;
      continue;
    }

    if (nestedMarker && nestedMarker.indent <= baseIndent) break;

    if (currentChild && /^\s+/.test(raw)) {
      currentChild.text = `${currentChild.text} ${trimmed}`;
    } else if (current) {
      current.text = `${current.text} ${trimmed}`;
    } else {
      break;
    }
    index += 1;
  }

  return { items, nextIndex: index };
}

export function renderMarkdown(
  markdown: string,
  release: ChangelogRelease,
  repo: string,
  releaseSummaries: Record<string, string>
): HTMLElement {
  const root = el('div', 'release-body');
  const summaryText = summarizeRelease(release, markdown, releaseSummaries);
  const summary = el('p', 'release-summary');
  appendInline(summary, summaryText, repo);
  root.append(summary);

  const lines = normalizeMarkdown(markdown).split('\n');
  let i = 0;
  let summaryPrefixConsumed = false;
  const trimSummaryPrefix = (text: string) => {
    if (summaryPrefixConsumed || !summaryText) return text;
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized.startsWith(summaryText)) return text;
    summaryPrefixConsumed = true;
    return normalized.slice(summaryText.length).trim();
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('<!--') || isGeneratedReleaseBoilerplate(trimmed, release)) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const lang = trimmed.replace(/^```/, '').trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      const pre = document.createElement('pre');
      pre.className = 'release-code';
      const codeNode = document.createElement('code');
      codeNode.className = 'release-code-content';
      if (lang) {
        pre.dataset.lang = lang;
        codeNode.dataset.lang = lang;
      }
      codeNode.textContent = code.join('\n');
      pre.append(codeNode);
      root.append(pre);
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      if (isDuplicateReleaseHeading(heading[2], release)) {
        i += 1;
        continue;
      }
      const depth = Math.min(heading[1].length + 2, 5);
      const node = el(`h${depth}`, 'release-heading');
      appendInline(node, normalizeReleaseHeading(heading[2]), repo);
      root.append(node);
      i += 1;
      continue;
    }

    if (listMarker(raw, false)) {
      const block = collectList(lines, i, false, release);
      addList(root, block.items, false, repo);
      i = block.nextIndex;
      continue;
    }

    if (listMarker(raw, true)) {
      const block = collectList(lines, i, true, release);
      addList(root, block.items, true, repo);
      i = block.nextIndex;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const blockquote = el('blockquote', 'release-quote');
      appendInline(blockquote, quote.join(' '), repo);
      root.append(blockquote);
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isGeneratedReleaseBoilerplate(lines[i].trim(), release) &&
      !lines[i].trim().startsWith('```') &&
      !/^(#{1,4})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('>')
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    addParagraph(root, paragraph, repo, trimSummaryPrefix);
  }

  if (root.children.length === 1) {
    root.append(el('p', 'release-paragraph', 'No release notes were published for this release.'));
  }

  return root;
}
