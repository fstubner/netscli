import { ENABLE_SEMANTIC_HINT } from "../../handoff/embedding-runtime.js";
import type { HandoffStatus, SessionService } from "../../handoff/types.js";
import { estimateVectorBacklog, formatDuration } from "../../utils/duration.js";
import { sanitizeErrorMessage } from "../../utils/errors.js";
import { inlineSafe } from "../../utils/untrusted-text.js";
import { isAbsolute, relative, sep } from "node:path";

interface ContinuityStatusParams {
  format?: "markdown" | "json";
}

export function createContinuityStatusHandler(service: SessionService) {
  return async (raw: Record<string, unknown> = {}) => {
    const params = raw as unknown as ContinuityStatusParams;
    const status = await service.getStatus();

    if (params.format === "json") {
      // Deliberate allowlist: store_paths are machine-wide absolute paths
      // (home directory layout) that the model-facing surface must not leak.
      // The markdown branch below omits them for the same reason.
      return {
        ...status,
        embedding_error: status.embedding_error
          ? sanitizeErrorMessage(status.embedding_error)
          : null,
        tools: status.tools.map((tool) => ({
          tool: tool.tool,
          detected: tool.detected,
          // Scrape errors quote the store path they failed on, which is
          // machine-wide (home directory layout) like store_paths above.
          last_error: tool.last_error ? sanitizeErrorMessage(tool.last_error) : null,
          indexed_sessions: tool.indexed_sessions,
          indexed_messages: tool.indexed_messages,
          last_indexed_at: tool.last_indexed_at,
        })),
      };
    }

    const lines = [
      "## xtctx Continuity Status",
      "",
      `- Project root: ${inlineSafe(status.project_root)}`,
      // Relative to the project root, which is on the line above. Absolute it
      // carried the home-directory layout that `store_paths` is redacted for
      // two branches up, while adding nothing the root does not already say.
      `- Index: ${relativeToProject(status.db_path, status.project_root)}`,
      `- Last scan: ${status.last_scan_at ?? "never"}${formatDuration(status.last_scan_ms) ? ` (took ${formatDuration(status.last_scan_ms)})` : ""}`,
      `- Sessions: ${status.sessions}`,
      `- Messages: ${status.messages}`,
      `- Retrieval windows: ${status.retrieval_units}`,
      // Said first and in words, so an agent reading this can tell "keyword
      // only, by default" from "semantic search is broken" without inferring it
      // from a zero below.
      ...semanticSearchLines(status),
      `- Vectorized windows: ${status.vectorized_units}`,
      // The backlog as a duration, so an agent can tell "semantic search is
      // still warming up" from "semantic search is ready".
      ...(() => {
        const backlog = estimateVectorBacklog(
          status.retrieval_units,
          status.vectorized_units,
          status.vector_ms_per_unit,
          {
            backlog: status.vector_segment_backlog,
            msPerSegment: status.vector_ms_per_segment,
          },
        );
        if (backlog.remaining === 0) return [];
        return [
          `- Embedding outstanding: ${backlog.remaining} windows` +
            `${backlog.eta ? ` (about ${backlog.eta})` : ""}`,
        ];
      })(),
      ...(status.semantic_search === "off" ? [] : [`- Vector model: ${inlineSafe(status.vector_model)}`]),
      ...(status.embedding_error
        ? [`- Semantic search unavailable (keyword only): ${inlineSafe(sanitizeErrorMessage(status.embedding_error))}`]
        : []),
      // Named, not pathed: `store_paths` is redacted from this surface two
      // branches up because it carries the machine's home-directory layout,
      // and a warning does not get an exception from that.
      ...(status.redirected_tools.length > 0
        ? [
            `- WARNING: ${status.redirected_tools.map(inlineSafe).join(", ")} read transcripts from a store ` +
              "outside the home directory, set by .xtctx/config.yaml. That file is " +
              "committable, so a cloned repo can carry one — the sessions returned for " +
              "these tools may not be this project's.",
          ]
        : []),
      "",
      "### Tools",
    ];

    for (const tool of status.tools) {
      const detected = tool.detected ? "detected" : "not detected";
      const error = tool.last_error
        ? `, last scrape error: ${inlineSafe(sanitizeErrorMessage(tool.last_error))}`
        : "";
      lines.push(
        `- ${inlineSafe(tool.tool)}: ${detected}, ${tool.indexed_sessions} sessions, ` +
          `${tool.indexed_messages} messages${error}`,
      );
    }

    return lines.join("\n");
  };
}

function semanticSearchLines(status: HandoffStatus): string[] {
  if (status.semantic_search === "remote") {
    return ["- Semantic search: on (external embedding endpoint)"];
  }
  if (status.semantic_search === "local") {
    return ["- Semantic search: on (local model)"];
  }
  return [
    status.semantic_off_reason === "disabled_by_env"
      ? "- Semantic search: off (XTCTX_DISABLE_EMBEDDINGS=1), answering from keyword only"
      : `- Semantic search: off, answering from keyword only. To turn it on, ${ENABLE_SEMANTIC_HINT}`,
  ];
}

/** `<project>/.xtctx/...` rather than the machine's absolute layout. */
function relativeToProject(dbPath: string, projectRoot: string): string {
  const rel = relative(projectRoot, dbPath);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : dbPath;
}
