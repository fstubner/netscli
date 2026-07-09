import type { BareUrlToken, MarkdownLinkToken, PullRequestToken } from './types';

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function safeHref(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function externalLink(href: string, label: string, className = 'external-link'): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = href;
  link.className = className;
  const text = document.createElement('span');
  text.className = 'external-link-label';
  text.textContent = label;
  link.append(text);
  return link;
}

export function readMarkdownLink(text: string, start: number): MarkdownLinkToken | null {
  if (text[start] !== '[') return null;
  let depth = 1;
  let cursor = start + 1;
  for (; cursor < text.length; cursor += 1) {
    if (text[cursor] === '\\' && cursor + 1 < text.length) {
      cursor += 1;
      continue;
    }
    if (text[cursor] === '[') depth += 1;
    if (text[cursor] === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  if (depth !== 0 || text[cursor + 1] !== '(') return null;

  let end = cursor + 2;
  let parens = 1;
  let href = '';
  for (; end < text.length; end += 1) {
    const char = text[end];
    if (char === '\\' && end + 1 < text.length) {
      href += text[end + 1];
      end += 1;
      continue;
    }
    if (char === '(') {
      parens += 1;
      href += char;
      continue;
    }
    if (char === ')') {
      parens -= 1;
      if (parens === 0) break;
      href += char;
      continue;
    }
    href += char;
  }

  if (parens !== 0) return null;

  return {
    label: text.slice(start + 1, cursor).replace(/\\([[\]\\()])/g, '$1'),
    href: href.trim().split(/\s+/)[0],
    end: end + 1,
  };
}

export function readBareUrl(text: string, start: number): BareUrlToken | null {
  const match = text.slice(start).match(/^https?:\/\/[^\s<]+/);
  if (!match) return null;
  let href = match[0];
  let suffix = '';
  while (/[.,;:!?)]$/.test(href)) {
    suffix = `${href.at(-1)}${suffix}`;
    href = href.slice(0, -1);
  }
  return { href, label: href, suffix, end: start + href.length + suffix.length };
}

export function readPullRequestRef(text: string, start: number, repo: string): PullRequestToken | null {
  if (text[start] !== '#') return null;
  const previous = text[start - 1] || '';
  if (previous && !/[\s([,;:]/.test(previous)) return null;
  const match = text.slice(start).match(/^#(\d+)\b/);
  if (!match) return null;
  return {
    href: `https://github.com/${repo}/pull/${match[1]}`,
    label: match[0],
    end: start + match[0].length,
  };
}

export function appendInline(parent: Element, text: string, repo: string): void {
  let cursor = 0;
  let plain = '';
  const flush = () => {
    if (!plain) return;
    parent.append(document.createTextNode(plain));
    plain = '';
  };

  while (cursor < text.length) {
    if (text.startsWith('`', cursor)) {
      const end = text.indexOf('`', cursor + 1);
      if (end > cursor) {
        flush();
        parent.append(el('code', '', text.slice(cursor + 1, end)));
        cursor = end + 1;
        continue;
      }
    }

    if (text.startsWith('**', cursor)) {
      const end = text.indexOf('**', cursor + 2);
      if (end > cursor) {
        flush();
        const strong = el('strong', '');
        appendInline(strong, text.slice(cursor + 2, end), repo);
        parent.append(strong);
        cursor = end + 2;
        continue;
      }
    }

    if (text[cursor] === '@' && text[cursor + 1] === '[') {
      const link = readMarkdownLink(text, cursor + 1);
      const href = link && safeHref(link.href);
      if (link && href) {
        flush();
        parent.append(externalLink(href, `@${link.label}`));
        cursor = link.end;
        continue;
      }
    }

    if (text[cursor] === '[') {
      const link = readMarkdownLink(text, cursor);
      const href = link && safeHref(link.href);
      if (link && href) {
        flush();
        parent.append(externalLink(href, link.label));
        cursor = link.end;
        continue;
      }
    }

    if (text[cursor] === '#') {
      const pr = readPullRequestRef(text, cursor, repo);
      if (pr) {
        flush();
        parent.append(externalLink(pr.href, pr.label));
        cursor = pr.end;
        continue;
      }
    }

    if (text.startsWith('https://', cursor) || text.startsWith('http://', cursor)) {
      const url = readBareUrl(text, cursor);
      const href = url && safeHref(url.href);
      if (url && href) {
        flush();
        parent.append(externalLink(href, url.label));
        if (url.suffix) parent.append(document.createTextNode(url.suffix));
        cursor = url.end;
        continue;
      }
    }

    plain += text[cursor];
    cursor += 1;
  }

  flush();
}
