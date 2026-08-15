import type { ReactNode } from 'react';

export function JsonPreview({ value }: { value: string }) {
  return (
    <pre className="json-preview">
      <code>{highlightJson(value)}</code>
    </pre>
  );
}

function highlightJson(value: string): ReactNode[] {
  const tokenPattern =
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:])/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }
    const token = match[0];
    nodes.push(
      <span className={`json-token ${jsonTokenClass(token, value[tokenPattern.lastIndex] ?? '')}`} key={`${match.index}-${token}`}>
        {token}
      </span>,
    );
    cursor = tokenPattern.lastIndex;
  }

  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }
  return nodes;
}

function jsonTokenClass(token: string, next: string): string {
  if (token.startsWith('"')) return next === ':' ? 'json-key' : 'json-string';
  if (token === 'true' || token === 'false') return 'json-boolean';
  if (token === 'null') return 'json-null';
  if (/^-?\d/.test(token)) return 'json-number';
  return 'json-punctuation';
}

