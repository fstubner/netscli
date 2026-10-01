import { realpathSync } from "node:fs";
import type { Database as DatabaseHandle } from "better-sqlite3";
import type { CountRow } from "./schema.js";

/**
 * SQL that reduces a stored `project_root` to a comparable form, and the JS
 * that does the same to the value compared against it.
 *
 * Raw string equality was too strict, and the way it failed is the dangerous
 * direction: rows silently stop being returned. One directory has several
 * legitimate spellings — `/var/...` and `/private/var/...` for a macOS temp
 * dir, `H:\` and `H:/` separators on Windows, and case differences on both — and
 * rows written under one spelling are read under another whenever the writer
 * canonicalised and the reader did not, or vice versa. Any row written before
 * the root was canonicalised at all would have vanished from every read.
 */
export const PROJECT_ROOT_SQL = `rtrim(replace(lower(project_root), '\\', '/'), '/')`;

export function normalizeRootForCompare(value: string): string {
  return value.replace(/\\/g, "/").replace(/[/]+$/, "").toLowerCase();
}

/**
 * The project root as the filesystem reports it, so writes and reads agree.
 *
 * Resolving at both ends is what makes the comparison work at all. One
 * directory has two names whenever a symlink is involved — a macOS temp
 * directory is `/var/...` and `/private/var/...`, and `createProjectServices`
 * already resolves it while a directly-constructed index did not. Rows
 * written under one name were then invisible under the other, which reads as
 * an empty project rather than as a bug.
 *
 * Falls back to the given path when it is not on disk, which is the case for
 * diagnostics and for a project that has moved.
 */
export function canonicalRoot(projectRoot: string): string {
  try {
    return realpathSync(projectRoot);
  } catch {
    return projectRoot;
  }
}

/**
 * How much of a window's text the search paths load.
 *
 * They use it for one thing: a 240-character preview, produced by collapsing
 * whitespace and slicing. Selecting the whole column meant every search read
 * the entire vectorised corpus into memory — 1,770 windows measured at 22.6MB
 * on a modest index, growing linearly, paid on every query, in a process
 * spawned per agent session.
 *
 * Four times the preview so whitespace collapsing cannot leave it short, and
 * still a small fraction of a window, which holds eight messages.
 */
const PREVIEW_SOURCE_CHARS = 960;

export function retrievalUnitSelect(): string {
  return `SELECT u.id AS unit_id,
                u.session_ref,
                u.tool,
                u.message_start_index,
                u.message_end_index,
                u.started_at,
                u.ended_at,
                substr(u.content, 1, ${PREVIEW_SOURCE_CHARS}) AS content,
                u.content_hash,
                s.started_at AS session_started_at,
                s.last_activity_at AS session_last_activity_at,
                s.message_count AS session_message_count,
                s.preview AS session_preview,
                s.source_path`;
}

/**
 * Words too common to be evidence of anything.
 *
 * Terms are OR-ed, so one match anywhere returns a session. That made a
 * question about sourdough bread return five results from a corpus about a
 * TypeScript project, because it contains "how", "do" and "make" — and hybrid
 * then presented them beside a similarity of 0.130 as though they were finds.
 * Deliberately short: it holds words that carry no signal in any corpus, not a
 * general English stoplist, because a term like "test" or "index" is exactly
 * what someone searching a transcript means.
 */
const FTS_STOPWORDS = new Set([
  "a", "about", "all", "an", "and", "any", "are", "as", "at", "be", "been", "but", "by", "can",
  "did", "do", "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "into",
  "is", "it", "its", "just", "me", "my", "no", "not", "of", "on", "or", "our", "out",
  "should", "so", "some", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "to", "up", "us", "want", "was", "we", "were", "what", "when",
  "why", "will", "with", "would", "you", "your",
]);

/**
 * `make`, `get` and `which` were on this list and should not have been. Each is
 * a real search term in a corpus of developer transcripts — a keyword search
 * for `make` returned nothing at all against 1475 windows. A stoplist that
 * swallows the vocabulary of the thing being searched is worse than the noise
 * it removes.
 *
 * The rest stay because they carry no signal as bare words. `so` is on the list
 * and `libfoo.so` still searches fine: the tokenizer keeps dotted and
 * hyphenated terms whole, so only the bare word is dropped.
 */

export function toFtsQuery(query: string): string {
  const terms = query.toLowerCase().match(/[a-z0-9_./:-]{2,}/g) ?? [];
  const meaningful = terms.filter((term) => !FTS_STOPWORDS.has(term));

  // A query of nothing but common words has nothing to search for. Returning
  // no results is the honest answer; matching on "how" is not.
  return meaningful.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}

/**
 * A row count restricted to this project. The `where` clause is built from
 * literals in the calling module and the value is bound, never interpolated.
 *
 * There is no unscoped variant: the one that existed reported totals that
 * disagreed with what every retrieval path returned.
 */
export function countWhere(
  db: DatabaseHandle,
  table: "sessions" | "messages" | "retrieval_units" | "retrieval_unit_vectors",
  where: string,
  scopedRoot: string,
): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(scopedRoot) as
    | CountRow
    | undefined;
  return row?.count ?? 0;
}
