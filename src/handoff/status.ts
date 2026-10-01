import type { Database as DatabaseHandle } from "better-sqlite3";
import type { ConversationScraper } from "../types/scraper.js";
import { PROJECT_ROOT_SQL, countWhere } from "./queries.js";
import { getSetting } from "./schema.js";
import { safeDetect } from "./scan.js";
import type { HandoffStatus, IndexProgress } from "./types.js";
import { countUnvectorizedSegments } from "./vectors.js";

interface ToolCountRow {
  tool: string;
  sessions: number;
  messages: number;
  last_indexed_at: string | null;
}

interface StatusToolRuntime {
  tool: string;
  scraper: ConversationScraper;
}

interface StatusInputs {
  db: DatabaseHandle;
  /** Canonical and normalized; see `canonicalRoot` in queries. */
  scopedRoot: string;
  /**
   * The root as given, not `scopedRoot`. That one is lowercased and
   * separator-folded for comparison; showing it to a person or an agent
   * would report a path that is not how their project is spelled.
   */
  projectRoot: string;
  dbPath: string;
  tools: StatusToolRuntime[];
  redirectedTools: string[];
  vectorModel: string;
  /** Execution provider the indexer will load on; see HandoffStatus. */
  vectorDevice: string | null;
}

/**
 * Settings are text; a value written by an older version, or by hand, must
 * not turn a status report into NaN.
 */
function numericSetting(db: DatabaseHandle, key: string): number | null {
  const raw = getSetting(db, key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function indexedByTool(db: DatabaseHandle, scopedRoot: string): Map<string, ToolCountRow> {
  return new Map(
    (
      db
        .prepare(
          `SELECT s.tool,
                    COUNT(DISTINCT s.session_ref) AS sessions,
                    COUNT(m.id) AS messages,
                    MAX(m.indexed_at) AS last_indexed_at
             FROM sessions s
             LEFT JOIN messages m ON m.session_ref = s.session_ref
             WHERE ${PROJECT_ROOT_SQL.replace("project_root", "s.project_root")} = ?
             GROUP BY s.tool`,
        )
        .all(scopedRoot) as ToolCountRow[]
    ).map((row) => [row.tool, row]),
  );
}

/** Everything `getStatus` reports, given an already-refreshed database. */
export async function buildStatus(inputs: StatusInputs): Promise<HandoffStatus> {
  const { db, scopedRoot, projectRoot, dbPath, tools, redirectedTools, vectorModel, vectorDevice } = inputs;
  // Scoped like the read paths. Unscoped counts disagreed with what the
  // retrieval tools return, and a status saying "3 sessions" for a project
  // whose searches return one is the report that makes a scoping bug look
  // like a search bug.
  const scoped = `WHERE session_ref IN (
      SELECT session_ref FROM sessions WHERE ${PROJECT_ROOT_SQL} = ?
    )`;
  const sessionCount = countWhere(db, "sessions", `WHERE ${PROJECT_ROOT_SQL} = ?`, scopedRoot);
  const messageCount = countWhere(db, "messages", scoped, scopedRoot);
  const retrievalUnitCount = countWhere(db, "retrieval_units", scoped, scopedRoot);
  const vectorizedUnitCount = countWhere(
    db,
    "retrieval_unit_vectors",
    `WHERE unit_id IN (SELECT id FROM retrieval_units ${scoped})`,
    scopedRoot,
  );
  const lastScan = getSetting(db, "last_scan_at");
  const indexed = indexedByTool(db, scopedRoot);

  const toolStatuses = await Promise.all(
    tools.map(async ({ tool, scraper }) => {
      const detected = await safeDetect(scraper);
      const counts = indexed.get(tool);
      return {
        tool,
        detected,
        store_paths: scraper.getStorePaths(),
        indexed_sessions: counts?.sessions ?? 0,
        indexed_messages: counts?.messages ?? 0,
        last_indexed_at: counts?.last_indexed_at ?? null,
        last_error: getSetting(db, `last_error:${tool}`),
      };
    }),
  );

  return {
    project_root: projectRoot,
    db_path: dbPath,
    last_scan_at: lastScan,
    last_scan_ms: numericSetting(db, "last_scan_ms"),
    sessions: sessionCount,
    messages: messageCount,
    retrieval_units: retrievalUnitCount,
    vectorized_units: vectorizedUnitCount,
    vector_ms_per_unit: numericSetting(db, "vector_ms_per_unit"),
    vector_segment_backlog: countUnvectorizedSegments(db, vectorModel, scopedRoot),
    vector_ms_per_segment: numericSetting(db, "vector_ms_per_segment"),
    vector_model: vectorModel,
    vector_device: vectorDevice,
    embedding_error: getSetting(db, "last_error:embeddings"),
    redirected_tools: redirectedTools,
    tools: toolStatuses,
  };
}

interface ProgressInputs {
  scanning: boolean;
  tools: Array<{ tool: string }>;
  /** Tools read at least once this process; see `scannedTools` on the index. */
  scannedTools: ReadonlySet<string>;
  vectorBacklog: number;
  embeddingWarming: boolean;
  literalSearchStoppedEarly?: boolean;
  /**
   * Declared, and copied below, because the caller passes it by spread.
   *
   * Excess-property checking does not apply to a spread, so an undeclared
   * field is dropped here in silence: `literalUnreadableTools` reached this
   * function and never left it, which left the unreadable-store branch in
   * `mcp/tools/sessions.ts` permanently unreachable. A store that cannot be
   * read was therefore always reported as a search that stopped at its limit,
   * advising the caller to narrow a query — the exact wrong advice that
   * branch was written to replace, since narrowing a query against an
   * unreadable store returns the same nothing forever.
   */
  literalUnreadableTools?: string[];
}

export function buildIndexProgress(inputs: ProgressInputs): IndexProgress {
  return {
    scanning: inputs.scanning,
    unreadTools: inputs.tools
      .map(({ tool }) => tool)
      .filter((tool) => !inputs.scannedTools.has(tool)),
    vectorBacklog: inputs.vectorBacklog,
    embeddingWarming: inputs.embeddingWarming,
    ...(inputs.literalSearchStoppedEarly === undefined
      ? {}
      : { literalSearchStoppedEarly: inputs.literalSearchStoppedEarly }),
    ...(inputs.literalUnreadableTools === undefined
      ? {}
      : { literalUnreadableTools: inputs.literalUnreadableTools }),
  };
}
