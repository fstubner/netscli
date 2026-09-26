import type { Database as DatabaseHandle } from "better-sqlite3";
import {
  MAX_SEGMENTS_PER_UNIT,
  MAX_SEQ_CHARS,
  poolVectors,
  splitTextForEmbedding,
  type EmbeddingProvider,
  capSegments,
} from "./embeddings.js";
import { type CountRow, placeholders, setSetting } from "./schema.js";
import { serializeVector } from "./vector.js";
import { PROJECT_ROOT_SQL } from "./queries.js";

/** Poll interval while waiting for the model; see `waitUntilEmbeddingReady`. */
const EMBEDDING_WARM_POLL_MS = 100;

/**
 * Poll until the embedding model is loaded, or the budget runs out.
 *
 * Polling rather than awaiting the load: `warm()` returns void by design, so
 * that a caller cannot accidentally block on it. The interval is short
 * relative to a model load and the whole wait is capped, so the cost of a
 * provider that never becomes ready is one bounded delay per scan.
 */
export async function waitUntilEmbeddingReady(
  embeddingProvider: EmbeddingProvider,
  embeddingWarmBudgetMs: number,
): Promise<boolean> {
  const isReady = embeddingProvider.isReady;
  if (!isReady) {
    return true;
  }

  const deadline = Date.now() + embeddingWarmBudgetMs;
  while (Date.now() < deadline) {
    if (isReady.call(embeddingProvider)) {
      return true;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, EMBEDDING_WARM_POLL_MS);
      // Never hold the process open purely to keep polling.
      timer.unref?.();
    });
  }

  return isReady.call(embeddingProvider);
}

/**
 * Discard vectors built by any model other than the one now in use.
 *
 * Every read filters on `model`, so stale rows are already inert — but
 * nothing deletes them, and changing the default model would otherwise
 * leave a whole second copy of the corpus in the index permanently. The
 * vectors are derived data that the next searches rebuild, so dropping
 * them costs re-embedding, which is budgeted and incremental, and no
 * transcript content is lost either way.
 */
export function dropVectorsFromOtherModels(db: DatabaseHandle, model: string): void {
  // Looked for first, and deleted only when there is something to delete: a
  // DELETE takes the write lock even when it matches nothing, and this runs
  // on every open, where another server's write is the normal case.
  const stale = db.prepare("SELECT 1 FROM retrieval_unit_vectors WHERE model != ? LIMIT 1").get(model);
  if (stale !== undefined) {
    db.prepare("DELETE FROM retrieval_unit_vectors WHERE model != ?").run(model);
  }
}

/**
 * Segments the outstanding windows will be split into — the real unit of work.
 *
 * A window is not one embedding. Its content is cut into `MAX_SEQ_CHARS`
 * pieces, capped at `MAX_SEGMENTS_PER_UNIT`, and every piece is its own pass
 * through the model. Measured on a real index: 9,322 windows, 74,908
 * segments, a mean of 7.7 and a fifth of them at the cap.
 *
 * That spread is why the estimate cannot be per window. Windows are processed
 * newest first and their sizes are not evenly distributed, so a rate measured
 * over the ones already done says little about the ones left: a real pass
 * averaged 391ms/window over its first half and 854ms/window overall.
 * Segments are all at most `MAX_SEQ_CHARS`, so their cost is roughly uniform
 * and the arithmetic holds.
 *
 * Computed in SQL rather than by reading content out: the whole point is to
 * cost the backlog without loading it.
 */
export function countUnvectorizedSegments(
  db: DatabaseHandle,
  model: string,
  /**
   * Count only this project's windows. `xtctx status` shows a per-project
   * window count beside this, and without the scope the two disagreed in any
   * index that holds another project's sessions (a copied `.xtctx/`, a renamed
   * root): "N windows outstanding" with a duration computed from more than N.
   */
  scopedRoot?: string,
): number {
  const row = db
    .prepare(
      // Integer ceiling, then the same cap `capSegments` applies. At least one
      // segment per window: an empty window is still a pass through the model.
      `SELECT COALESCE(SUM(MIN(MAX((LENGTH(u.content) + ${MAX_SEQ_CHARS - 1}) / ${MAX_SEQ_CHARS}, 1), ${MAX_SEGMENTS_PER_UNIT})), 0) AS count
       FROM retrieval_units u
       LEFT JOIN retrieval_unit_vectors v
         ON v.unit_id = u.id
        AND v.model = ?
        AND v.content_hash = u.content_hash
       WHERE v.unit_id IS NULL
       ${scopedRoot === undefined ? "" : `AND u.session_ref IN (SELECT session_ref FROM sessions WHERE ${PROJECT_ROOT_SQL} = ?)`}`,
    )
    .get(...(scopedRoot === undefined ? [model] : [model, scopedRoot])) as CountRow | undefined;
  return row?.count ?? 0;
}

/**
 * Windows with no vector for the current model.
 *
 * Counted from the index rather than remembered from the last vectorizing
 * pass: that pass only runs inside a search, so anything that had not run
 * one yet reported a backlog of zero — which a JSON consumer reads as
 * "nothing outstanding" while thousands of windows are unvectorized.
 */
export function countUnvectorizedUnits(db: DatabaseHandle, model: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM retrieval_units u
       LEFT JOIN retrieval_unit_vectors v
         ON v.unit_id = u.id
        AND v.model = ?
        AND v.content_hash = u.content_hash
       WHERE v.unit_id IS NULL`,
    )
    .get(model) as CountRow | undefined;
  return row?.count ?? 0;
}

/**
 * Windows read from the index at a time.
 *
 * Bounds the memory a pass holds: the rows carry each window's full content,
 * which averaged 46KB in a real index, so the whole backlog in one array came
 * to 104MB at 9,013 windows. Larger than the embedding batch on purpose — the
 * page is about memory, the batch is about how often the time budget can bite
 * — so the query runs once per 256 windows rather than once per 8.
 */
const UNIT_PAGE_SIZE = 256;

interface UnitRow {
  unit_id: string;
  content: string;
  content_hash: string;
}

interface EnsureVectorsOptions {
  db: DatabaseHandle;
  embeddingProvider: EmbeddingProvider;
  /** Tool names to restrict the pass to; already normalized, empty for all. */
  filters: string[];
  /** How long to spend before answering with what exists; `0` for no cap. */
  vectorBudgetMs: number;
  /**
   * Called after each batch commits, with how many windows this pass has
   * embedded and how many it set out to.
   *
   * Only meaningful for an uncapped pass, which is the one that runs for
   * hours: `xtctx scan --embed` on a large history has thousands of windows
   * to get through, and a command that prints nothing for two hours is
   * indistinguishable from one that has hung.
   */
  onProgress?: (embedded: number, total: number) => void;
}

/**
 * Vectorize windows that have no vector for the current model, most recent
 * first, within the budget.
 *
 * Returns how many windows were still waiting when the budget ran out.
 */
export async function ensureVectors({
  db,
  embeddingProvider,
  filters,
  vectorBudgetMs,
  onProgress,
}: EnsureVectorsOptions): Promise<number> {
  const toolWhere = filters.length > 0 ? `AND u.tool IN (${placeholders(filters.length)})` : "";
  const outstanding = `FROM retrieval_units u
       LEFT JOIN retrieval_unit_vectors v
         ON v.unit_id = u.id
        AND v.model = ?
        AND v.content_hash = u.content_hash
       WHERE v.unit_id IS NULL ${toolWhere}`;

  const countStatement = db.prepare(`SELECT COUNT(*) AS count ${outstanding}`);
  // A page, not the corpus. This selected every outstanding window's *full*
  // content in one array before embedding any of it, which is fine for the
  // handful a search gets through and is not fine for the whole backlog:
  // measured on a real 9,013-window index, that single allocation was 104MB.
  // `scan --embed` runs exactly this path at exactly that size.
  //
  // No OFFSET, deliberately. Every page commits its vectors before the next
  // query runs, so the embedded rows drop out of the WHERE and the same
  // `LIMIT` returns the next ones. Paging by offset over a result set that
  // shrinks underneath you skips rows.
  const pageStatement = db.prepare(
    `SELECT u.id AS unit_id, u.content, u.content_hash ${outstanding}
     ORDER BY u.ended_at DESC
     LIMIT ${UNIT_PAGE_SIZE}`,
  );
  const readPage = (): UnitRow[] =>
    pageStatement.all(embeddingProvider.model, ...filters) as UnitRow[];

  const total = (countStatement.get(embeddingProvider.model, ...filters) as CountRow | undefined)
    ?.count ?? 0;

  let vectorBacklog = 0;
  if (total === 0) {
    return vectorBacklog;
  }

  const upsert = db.prepare(
    `INSERT INTO retrieval_unit_vectors
     (unit_id, model, dimensions, content_hash, vector, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(unit_id, model) DO UPDATE SET
       dimensions = excluded.dimensions,
       content_hash = excluded.content_hash,
       vector = excluded.vector,
       created_at = excluded.created_at`,
  );

  // Bounded batches keep memory flat on a first-time index of a large
  // history, and each batch commits before the next one embeds.
  // Small enough that the budget below can actually bite. At 64 windows a
  // single batch took 20-30s on the real index, so the deadline — checked
  // between batches — could not stop a search from blowing straight past it.
  const unitBatchSize = 8;
  // Answer with the vectors that exist rather than making the caller wait
  // for the whole corpus. Every batch below commits before the next starts,
  // so an unfinished pass is progress, not wasted work.
  const deadline = vectorBudgetMs > 0 ? Date.now() + vectorBudgetMs : Infinity;
  const passStartedAt = Date.now();
  let embedded = 0;
  let segmentsEmbedded = 0;
  let rows = readPage();

  for (let start = 0; start < rows.length; start += unitBatchSize) {
    if (Date.now() >= deadline) {
      vectorBacklog = total - embedded;
      break;
    }
    const batch = rows.slice(start, start + unitBatchSize);
    embedded += batch.length;
    // Long windows are segmented to the model's sequence budget and
    // mean-pooled, so content beyond the window's opening still shapes
    // the unit's vector.
    const segmented = batch.map((row) => capSegments(splitTextForEmbedding(row.content)));
    segmentsEmbedded += segmented.reduce((total, segments) => total + segments.length, 0);
    const segmentVectors = await embeddingProvider.embedBatch(segmented.flat());

    let cursor = 0;
    const pooled = segmented.map((segments) => {
      const slice = segmentVectors.slice(cursor, cursor + segments.length);
      cursor += segments.length;
      return poolVectors(slice);
    });

    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      batch.forEach((row, index) => {
        const vector = pooled[index];
        upsert.run(
          row.unit_id,
          embeddingProvider.model,
          vector.length,
          row.content_hash,
          serializeVector(vector),
          now,
        );
      });
    });
    transaction();
    // Published as the pass runs, not once it ends.
    //
    // This used to be written after the loop, which is invisible for the
    // seconds-long passes a search makes and badly wrong for the hours-long
    // one `scan --embed` makes: for the whole run, `status` reported the rate
    // of whatever small pass finished last, and multiplied it by thousands of
    // outstanding windows. A real 92-minute run was reported throughout as
    // having about 19 minutes left, off by a factor of four, because the
    // stored rate came from a six-second search pass over small windows.
    //
    // Cumulative over this pass rather than per batch, so the figure is an
    // average over everything embedded so far instead of the last eight
    // windows — window sizes vary from one segment to the capped sixteen, and
    // a per-batch rate swings with whatever it happened to land on.
    recordRate(db, passStartedAt, embedded, segmentsEmbedded);
    // After the commit, so the number reported is work that survives an
    // interrupt rather than work in flight.
    onProgress?.(embedded, total);

    // Page exhausted: fetch the next one and restart the batch cursor. The
    // committed rows no longer match, so this returns windows not yet seen.
    if (start + unitBatchSize >= rows.length) {
      rows = readPage();
      start = -unitBatchSize;
      if (rows.length === 0) {
        break;
      }
    }
  }

  // Once more at the end, so a pass that stopped mid-batch still leaves the
  // rate covering everything it did.
  recordRate(db, passStartedAt, embedded, segmentsEmbedded);

  return vectorBacklog;
}

/**
 * Publish how long a window is taking, averaged over this pass so far.
 *
 * Per window rather than per pass, so a pass that embedded eight and one that
 * embedded eight hundred report a comparable figure — and so the backlog can
 * be read as a duration rather than a count.
 */
function recordRate(
  db: DatabaseHandle,
  passStartedAt: number,
  embedded: number,
  segmentsEmbedded: number,
): void {
  if (embedded <= 0) {
    return;
  }
  const elapsed = Date.now() - passStartedAt;
  setSetting(db, "vector_ms_per_unit", String(Math.round((elapsed / embedded) * 10) / 10));
  // The figure the estimate actually uses; the per-window one above is what
  // `status` shows a person, because a window is the thing they can count.
  if (segmentsEmbedded > 0) {
    setSetting(
      db,
      "vector_ms_per_segment",
      String(Math.round((elapsed / segmentsEmbedded) * 100) / 100),
    );
  }
}
