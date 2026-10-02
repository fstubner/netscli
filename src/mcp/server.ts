import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createContinuityStatusHandler } from "./tools/continuity.js";
import { createHandoffManifestHandler } from "./tools/manifest.js";
import {
  createRecentSessionsHandler,
  createSearchSessionsHandler,
  createSessionDetailHandler,
  ToolInputError,
  type SessionService,
} from "./tools/sessions.js";
import { errorMessage, sanitizeErrorMessage } from "../utils/errors.js";
import { readXtctxPackage } from "../utils/package-info.js";
import { inlineSafe } from "../utils/untrusted-text.js";
import { SUPPORTED_TOOLS } from "../tools/sources.js";

/** The tool ids `tool_filter` accepts, straight from the tool registry. */
const TOOL_IDS = SUPPORTED_TOOLS.map((tool) => tool.id);

const { version: SERVER_VERSION } = readXtctxPackage(import.meta.url);

type ToolParams = Record<string, unknown>;
type ToolHandler = (params: ToolParams) => Promise<unknown>;

interface McpToolDependencies {
  sessions?: SessionService;
  /**
   * Set when this directory has no `.xtctx/config.yaml` — nobody opted it in.
   *
   * Two clients wire xtctx machine-globally, so the server is reachable from
   * every directory on the machine. Answering an unconfigured one with an
   * ordinary empty result made it indistinguishable from a configured project
   * with no history, and quietly spent a full scan of every transcript store
   * to say nothing. Naming it is what turns that global reach into
   * discovery: the agent that gets this answer is the one that can offer
   * setup to the person.
   */
  unconfiguredProjectRoot?: string;
  /**
   * Why `.xtctx/config.yaml` could not be read, if it could not.
   *
   * Separate from `unconfiguredProjectRoot`, because the two mean opposite
   * things to a user: nobody opted this directory in, against somebody did and
   * the file is broken. Both used to reach an agent as the same thing — an
   * ordinary empty answer — because a config that will not parse yields zero
   * scrapers, so every tool returned "No matching sessions found." and the
   * agent told the user there was no cross-tool history. The CLI says
   * `UNREADABLE`, but agents never read the CLI.
   */
  configError?: { projectRoot: string; configPath: string; message: string };
}

/** @internal Exported for tests only. */
export function buildToolDefinitions(): Tool[] {
  return [
    {
      name: "xtctx_recent_sessions",
      description:
        "List recent local transcript sessions for this project. Call this first when you need cross-tool handoff context.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max sessions. Default: 5" },
          tool_filter: {
            type: "array",
            // Enumerated, because the ids are not guessable: `claude-code` and
            // `antigravity`, against the natural guesses `claude` and `gemini`.
            // An id that matches nothing used to return "No matching sessions
            // found.", which an agent reports as an empty history.
            items: { type: "string", enum: TOOL_IDS },
            description: `Optional tool ids to include. One or more of: ${TOOL_IDS.join(", ")}`,
          },
          branch_filter: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional git branches to include, as recorded by the tool at session time. Sessions from tools that record no branch are excluded when this is set.",
          },
          format: {
            type: "string",
            enum: ["markdown", "json"],
            description: "Response format. Default: markdown",
          },
        },
      },
    },
    {
      name: "xtctx_session_detail",
      description: "Return raw messages from a session_ref returned by xtctx_recent_sessions or xtctx_search_sessions.",
      inputSchema: {
        type: "object",
        properties: {
          session_ref: { type: "string", description: "Session reference, e.g. codex:abc123" },
          offset: { type: "number", description: "Message offset for pagination" },
          limit: { type: "number", description: "Max messages to return. Default: 50" },
          format: {
            type: "string",
            enum: ["markdown", "json"],
            description: "Response format. Default: markdown",
          },
        },
        required: ["session_ref"],
      },
    },
    {
      name: "xtctx_search_sessions",
      description:
        "Hybrid semantic/keyword search over chronological transcript windows and return matching sessions.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language or keyword query" },
          limit: { type: "number", description: "Max sessions. Default: 5" },
          tool_filter: {
            type: "array",
            // Enumerated, because the ids are not guessable: `claude-code` and
            // `antigravity`, against the natural guesses `claude` and `gemini`.
            // An id that matches nothing used to return "No matching sessions
            // found.", which an agent reports as an empty history.
            items: { type: "string", enum: TOOL_IDS },
            description: `Optional tool ids to include. One or more of: ${TOOL_IDS.join(", ")}`,
          },
          branch_filter: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional git branches to include, as recorded by the tool at session time. Sessions from tools that record no branch are excluded when this is set.",
          },
          mode: {
            type: "string",
            enum: ["hybrid", "keyword", "vector", "literal"],
            description:
              "Retrieval mode. Default: hybrid. Use literal to match text directly in the transcript stores without the index — slower per query, but it answers before a scan has finished and finds exact strings the index has not reached yet.",
          },
          format: {
            type: "string",
            enum: ["markdown", "json"],
            description: "Response format. Default: markdown",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "xtctx_continuity_status",
      description: "Return xtctx handoff wiring and local index diagnostics.",
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["markdown", "json"],
            description: "Response format. Default: markdown",
          },
        },
      },
    },
    {
      name: "xtctx_handoff_manifest",
      description:
        "Return a read-only handoff manifest with stable session references and raw-detail retrieval pointers for an external orchestrator.",
      inputSchema: {
        type: "object",
        properties: {
          session_refs: {
            type: "array",
            items: { type: "string" },
            description: "Optional session refs to include. Defaults to recent sessions.",
          },
          tool_filter: {
            type: "array",
            // Enumerated, because the ids are not guessable: `claude-code` and
            // `antigravity`, against the natural guesses `claude` and `gemini`.
            // An id that matches nothing used to return "No matching sessions
            // found.", which an agent reports as an empty history.
            items: { type: "string", enum: TOOL_IDS },
            description: `Optional tool ids to include. One or more of: ${TOOL_IDS.join(", ")}`,
          },
          branch_filter: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional git branches to include, as recorded by the tool at session time. Sessions from tools that record no branch are excluded when this is set.",
          },
          limit: { type: "number", description: "Max recent sessions. Default: 5" },
          correlation_id: {
            type: "string",
            description: "Optional caller-owned ID echoed in the response and never persisted by xtctx.",
          },
          format: {
            type: "string",
            enum: ["markdown", "json"],
            description: "Response format. Default: json",
          },
        },
      },
    },
  ];
}

/** @internal Exported for tests only. */
export function createToolHandlers(
  dependencies: McpToolDependencies = {},
): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  if (dependencies.unconfiguredProjectRoot) {
    // `--yes` because the agent is who runs it, after the user agreed in the
    // chat, and an agent's shell is not interactive: setup without it stops
    // at "Refusing non-interactive setup without --yes", so the command this
    // named failed on the first try every time.
    for (const name of TOOL_NAMES) {
      handlers.set(name, asRequestedFormat(name, notConfigured(dependencies.unconfiguredProjectRoot), {
        status: "not_configured",
        project_root: dependencies.unconfiguredProjectRoot,
        setup_command: SETUP_COMMAND,
      }));
    }
    return handlers;
  }

  if (dependencies.configError) {
    for (const name of TOOL_NAMES) {
      handlers.set(name, asRequestedFormat(name, configUnreadable(dependencies.configError), {
        status: "config_unreadable",
        config_path: dependencies.configError.configPath,
        error: dependencies.configError.message,
      }));
    }
    return handlers;
  }

  if (dependencies.sessions) {
    handlers.set("xtctx_recent_sessions", createRecentSessionsHandler(dependencies.sessions));
    handlers.set("xtctx_session_detail", createSessionDetailHandler(dependencies.sessions));
    handlers.set("xtctx_search_sessions", createSearchSessionsHandler(dependencies.sessions));
    handlers.set("xtctx_continuity_status", createContinuityStatusHandler(dependencies.sessions));
    handlers.set("xtctx_handoff_manifest", createHandoffManifestHandler(dependencies.sessions));
  } else {
    const missing = missingDependency("session service");
    handlers.set("xtctx_recent_sessions", missing);
    handlers.set("xtctx_session_detail", missing);
    handlers.set("xtctx_search_sessions", missing);
    handlers.set("xtctx_continuity_status", missing);
    handlers.set("xtctx_handoff_manifest", missing);
  }

  return handlers;
}

function createMcpServer(dependencies: McpToolDependencies = {}): Server {
  const server = new Server(
    { name: "xtctx", version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  const tools = buildToolDefinitions();
  const handlers = createToolHandlers(dependencies);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const params = asToolParams(request.params.arguments);
    const handler = handlers.get(name);

    if (!handler) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }

    try {
      const result = await handler(params);
      return formatCallToolResult(result);
    } catch (error) {
      const text =
        error instanceof ToolInputError
          ? `Invalid arguments for ${name}: ${error.message}`
          : `Tool ${name} failed: ${sanitizeErrorMessage(errorMessage(error))}`;
      return {
        isError: true,
        content: [{ type: "text", text }],
      };
    }
  });

  return server;
}

export async function startMcpServer(
  dependencies: McpToolDependencies = {},
  onClose?: () => void,
): Promise<void> {
  const server = createMcpServer(dependencies);
  if (onClose) {
    server.onclose = onClose;
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // `server.onclose` does not fire when the host simply closes stdin, which is
  // how an MCP client normally goes away — so the callback above never ran and
  // the process lived on until the event loop happened to drain, measured at
  // 69-108 seconds after the client had gone. Watch the stream itself. The
  // handler is idempotent, so it does not matter which of these arrives first,
  // or whether `onclose` fires as well.
  if (onClose) {
    process.stdin.once("end", onClose);
    process.stdin.once("close", onClose);
  }
}

function asToolParams(value: unknown): ToolParams {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ToolParams;
  }

  return {};
}

/** Every tool an agent can reach, so a blanket answer cannot miss one. */
const TOOL_NAMES = [
  "xtctx_recent_sessions",
  "xtctx_session_detail",
  "xtctx_search_sessions",
  "xtctx_continuity_status",
  "xtctx_handoff_manifest",
] as const;

/**
 * Returned rather than thrown. This is not a failure — it is the answer, and
 * an `isError` response is something an agent reports as broken rather than
 * acts on.
 */
/** What the tools name in a project that is not set up; see createToolHandlers. */
const SETUP_COMMAND = "npx -y xtctx setup --yes";

function notConfigured(projectRoot: string): ToolHandler {
  return async () =>
    [
      `This project is not configured for xtctx: ${inlineSafe(projectRoot)}`,
      "",
      "Transcripts from other AI coding tools may already exist for it, but",
      "nothing is indexed and nothing has been written here.",
      "",
      "To enable cross-tool handoff, run in the project root:",
      "",
      `    ${SETUP_COMMAND}`,
      "",
      "Offer that to the user rather than running it unprompted — setup writes",
      "configuration into the repository and into one machine-global file.",
      "`--yes` is the user's agreement, given in the chat; setup needs it",
      "because it will not prompt in a non-interactive shell.",
    ].join("\n");
}

/**
 * Every tool answers with the broken file, rather than with nothing found.
 *
 * Returned, not thrown, for the same reason `notConfigured` is: this is a
 * state the user can fix, and an agent that receives it can say so. Throwing
 * would make it a tool malfunction, which is a different and less useful
 * message to pass on.
 */
function configUnreadable(details: {
  projectRoot: string;
  configPath: string;
  message: string;
}): ToolHandler {
  return async () =>
    [
      `xtctx cannot read this project's configuration: ${inlineSafe(details.configPath)}`,
      "",
      `    ${inlineSafe(details.message)}`,
      "",
      "No transcript stores are being read until that file parses, so this is",
      "not an empty history — it is an unread one. Nothing has been changed.",
      "",
      "Tell the user to fix or delete that file. `npx -y xtctx status` prints",
      "the same error. Do not edit it unprompted: it records which transcript",
      "stores they allowed to be read.",
    ].join("\n");
}

/**
 * Answer a notice in the format the caller asked for.
 *
 * Both notices used to be one prose string for every tool. `xtctx_handoff_manifest`
 * defaults to JSON and documents a versioned contract for orchestrators, so a
 * program calling it in an unconfigured directory got English it could not
 * parse and no `structuredContent` — while an agent reading markdown was fine.
 * The prose stays in the payload, because the words are what tell a person
 * what to do.
 */
function asRequestedFormat(
  toolName: string,
  prose: ToolHandler,
  fields: Record<string, unknown>,
): ToolHandler {
  return async (params: ToolParams) => {
    const text = await prose(params);
    const format = (params as { format?: unknown } | undefined)?.format;
    const wantsJson =
      format === "json" || (format === undefined && toolName === "xtctx_handoff_manifest");
    if (!wantsJson) {
      return text;
    }
    // Paths go through the same untrusted-text handling as the prose copy.
    const safeFields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        typeof value === "string" ? inlineSafe(value) : value,
      ]),
    );
    return { ...safeFields, message: text };
  };
}

function missingDependency(dependency: string): ToolHandler {
  return async () => {
    // Thrown (not returned) so the client sees isError, not a success shape.
    throw new Error(`Tool is unavailable because ${dependency} is not configured.`);
  };
}

function formatCallToolResult(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
} {
  const response: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
  } = {
    content: [
      {
        // Compact JSON: object results are also sent as structuredContent,
        // so pretty-printing the text copy would double the payload twice.
        type: "text",
        text: typeof result === "string" ? result : JSON.stringify(result),
      },
    ],
  };

  if (result && typeof result === "object" && !Array.isArray(result)) {
    response.structuredContent = result as Record<string, unknown>;
  }

  return response;
}
