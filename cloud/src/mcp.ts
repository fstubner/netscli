import type { Env, AuthUser, MessageRecord, SessionRecord } from "./types.js";
import { getRecentSessions, getSessionMessages, getUploadStatus } from "./db.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

/**
 * MCP over JSON-RPC, for two eras of client on one endpoint.
 *
 * Modern (2026-07-28): no handshake; every request carries its protocol
 * version in `params._meta` and, over HTTP, mirrors it and the method into
 * headers that must agree with the body. Legacy (2025-11-25, 2025-06-18, and
 * 2024-11-05 over the `/sse` transport): an `initialize` handshake. Neither
 * keeps session state here, so nothing depends on which isolate answers.
 *
 * JSON-RPC batches are refused: 2025-06-18 removed them and 2026-07-28 allows
 * one message per POST.
 */

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2024-11-05"];

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

const SERVER_INFO = { name: SERVER_NAME, version: SERVER_VERSION };

/**
 * 2026-07-28 caching hints, required on server/discover and tools/list. The
 * tool list and the discovery result are the same for every user, so they
 * are public; they change only with a deploy.
 */
const CACHE_PUBLIC = { ttlMs: 60 * 60 * 1000, cacheScope: "public" } as const;

const INSTRUCTIONS =
  "Transcripts you uploaded to xtctx cloud from your other machines. " +
  "Call xtctx_cloud_status first to see which projects and devices have uploaded and when; " +
  "then xtctx_cloud_recent_sessions and xtctx_cloud_session_detail. " +
  "For this machine's own sessions use the local xtctx tools.";

export const MCP_TOOLS = [
  {
    name: "xtctx_cloud_recent_sessions",
    description:
      "List sessions uploaded to your xtctx cloud account, newest first. Covers every device and every " +
      "project you have uploaded unless repo_url is given, which restricts it to one repository. " +
      "Use it to pick up work done on another machine; this machine's sessions are in the local xtctx tools.",
    inputSchema: {
      type: "object",
      properties: {
        repo_url: {
          type: "string",
          description: "Only sessions from this repository, as xtctx names it (e.g. github.com/user/repo).",
        },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "Max sessions to return, 1-25. Default 5." },
        tool_filter: {
          type: "array",
          items: { type: "string" },
          description: "Only these tools: claude-code, antigravity, cursor, copilot, codex, opencode.",
        },
        branch_filter: { type: "array", items: { type: "string" }, description: "Only these git branches." },
        format: { type: "string", enum: ["markdown", "json"], description: "Default markdown." },
      },
    },
  },
  {
    name: "xtctx_cloud_session_detail",
    description: "Return the messages of one uploaded session, in conversation order, by the session_ref that xtctx_cloud_recent_sessions gave.",
    inputSchema: {
      type: "object",
      required: ["session_ref"],
      properties: {
        session_ref: { type: "string", description: "A session_ref from xtctx_cloud_recent_sessions." },
        offset: { type: "integer", minimum: 0, description: "Messages to skip, for paging. Default 0." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Max messages to return, 1-100. Default 50." },
        format: { type: "string", enum: ["markdown", "json"], description: "Default markdown." },
      },
    },
  },
  {
    name: "xtctx_cloud_status",
    description:
      "When each of your devices last uploaded each project to xtctx cloud, and how many sessions it holds. " +
      "Tells a project that synced and has nothing new apart from one that never synced.",
    inputSchema: {
      type: "object",
      properties: {
        repo_url: { type: "string", description: "Only this repository." },
        format: { type: "string", enum: ["markdown", "json"], description: "Default markdown." },
      },
    },
  },
];

/** Thrown for arguments a tool cannot use; reported to the model as a tool error so it can correct them. */
class ArgumentError extends Error {}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ArgumentError(`${key} must be a string`);
  return v;
}

function optionalStrings(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string") || v.length > 20) {
    throw new ArgumentError(`${key} must be a list of at most 20 strings`);
  }
  return v as string[];
}

/** An integer clamped into [min, max]; anything that is not a number is an error, not "unlimited". */
function clampInt(args: Record<string, unknown>, key: string, min: number, max: number, fallback: number): number {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ArgumentError(`${key} must be a number`);
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function format(args: Record<string, unknown>): "markdown" | "json" {
  const v = optionalString(args, "format") ?? "markdown";
  if (v !== "markdown" && v !== "json") throw new ArgumentError(`format must be "markdown" or "json"`);
  return v;
}

const text = (body: string) => ({ content: [{ type: "text", text: body }] });
const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const deviceLabel = (s: { device_name?: string | null; device_id: string }) => s.device_name || s.device_id;

function publicSession(s: SessionRecord) {
  return {
    session_ref: s.session_ref,
    tool: s.tool,
    repo_url: s.repo_url,
    project: s.project_root,
    device: deviceLabel(s),
    git_branch: s.git_branch,
    git_commit: s.git_commit,
    started_at: s.started_at,
    last_activity_at: s.last_activity_at,
    message_count: s.message_count,
    preview: s.preview,
  };
}

function publicMessage(m: MessageRecord) {
  let metadata: unknown = {};
  try {
    metadata = JSON.parse(m.metadata_json);
  } catch {
    // stored as sent; a bad one is shown as empty rather than failing the call
  }
  return { message_index: m.message_index, timestamp: m.timestamp, role: m.role, content: m.content, metadata };
}

/** Unknown tool: null, which the caller reports as a protocol error (-32602). */
export async function handleToolCall(
  env: Env,
  user: AuthUser,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    if (name === "xtctx_cloud_recent_sessions") {
      const fmt = format(args);
      const sessions = await getRecentSessions(env, user.userId, {
        repoUrl: optionalString(args, "repo_url"),
        limit: clampInt(args, "limit", 1, 25, 5),
        toolFilter: optionalStrings(args, "tool_filter"),
        branchFilter: optionalStrings(args, "branch_filter"),
      });
      if (fmt === "json") return text(JSON.stringify(sessions.map(publicSession), null, 2));
      if (sessions.length === 0) {
        return text(
          "No uploaded sessions match. Call xtctx_cloud_status to see whether this project has uploaded at all.",
        );
      }
      const lines = ["## Sessions in xtctx cloud", ""];
      for (const s of sessions) {
        const branch = s.git_branch ? ` on branch \`${s.git_branch}\`` : "";
        lines.push(
          `- **${s.tool}** from **${deviceLabel(s)}** in ${s.repo_url}${branch}`,
          `  - Last active ${s.last_activity_at} (${s.message_count} messages)`,
          `  - Preview: ${oneLine(s.preview) || "none"}`,
          `  - session_ref: \`${s.session_ref}\``,
        );
      }
      return text(lines.join("\n"));
    }

    if (name === "xtctx_cloud_session_detail") {
      const sessionRef = optionalString(args, "session_ref");
      if (!sessionRef) throw new ArgumentError("session_ref is required");
      const fmt = format(args);
      const offset = clampInt(args, "offset", 0, Number.MAX_SAFE_INTEGER, 0);
      const limit = clampInt(args, "limit", 1, 100, 50);
      const { session, messages } = await getSessionMessages(env, user.userId, sessionRef, { offset, limit });
      if (!session) {
        return { isError: true, ...text(`Session '${sessionRef}' not found. Use a session_ref from xtctx_cloud_recent_sessions.`) };
      }
      const page = { offset, returned: messages.length, total: session.message_count };
      if (fmt === "json") {
        return text(JSON.stringify({ session: publicSession(session), page, messages: messages.map(publicMessage) }, null, 2));
      }
      const lines = [
        `## ${session.tool} session from ${deviceLabel(session)}`,
        `${session.repo_url}${session.git_branch ? ` on \`${session.git_branch}\`` : ""}, ${session.started_at} to ${session.last_activity_at}`,
        `Messages ${offset + 1}-${offset + messages.length} of ${session.message_count}.`,
        "",
      ];
      for (const m of messages) {
        lines.push(`### ${m.role} (#${m.message_index}, ${m.timestamp})`, "", m.content, "");
      }
      if (offset + messages.length < session.message_count) {
        lines.push(`More: call again with offset ${offset + messages.length}.`);
      }
      return text(lines.join("\n"));
    }

    if (name === "xtctx_cloud_status") {
      const fmt = format(args);
      const rows = await getUploadStatus(env, user.userId, optionalString(args, "repo_url"));
      if (fmt === "json") return text(JSON.stringify(rows, null, 2));
      if (rows.length === 0) {
        return text(
          "Nothing has been uploaded to this xtctx cloud account" +
            (args.repo_url ? " for that repository" : "") +
            ". On the machine that has the sessions, run `xtctx sync enable` in the project, then `xtctx sync`.",
        );
      }
      const lines = ["## xtctx cloud uploads", "", "| Project | Device | Last upload | Sessions |", "|---|---|---|---|"];
      for (const r of rows) {
        lines.push(`| ${r.project_name} (${r.repo_url}) | ${r.device_name ?? r.device_id} | ${r.last_upload_at} | ${r.sessions} |`);
      }
      return text(lines.join("\n"));
    }
  } catch (err) {
    if (err instanceof ArgumentError) return { isError: true, ...text(`Invalid arguments: ${err.message}`) };
    throw err;
  }
  return null;
}

export interface RpcOutcome {
  /** HTTP status for the HTTP transport. */
  status: number;
  /** JSON-RPC message to send back, or null for none (a notification). */
  body: Record<string, unknown> | null;
}

const error = (status: number, id: unknown, code: number, message: string, data?: unknown): RpcOutcome => ({
  status,
  body: { jsonrpc: "2.0", id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } },
});

/** Base64 sentinel decoding for mirrored header values (`=?base64?...?=`). */
function decodeHeaderValue(value: string): string {
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(value);
  if (!m) return value;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return "\u0000invalid";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Handle one parsed JSON-RPC message. `headers` is given for Streamable HTTP,
 * whose modern-era header checks it enables; the SSE transport passes none.
 */
export async function processMessage(
  env: Env,
  user: AuthUser,
  message: unknown,
  headers?: Headers,
): Promise<RpcOutcome> {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return error(400, null, ERR.invalidRequest, "Invalid Request: expected a single JSON-RPC 2.0 object");
  }
  const { id, method } = message;

  if (typeof method !== "string") {
    // A response from the client (to nothing we sent) is accepted and dropped.
    if ("result" in message || "error" in message) return { status: 202, body: null };
    return error(400, id, ERR.invalidRequest, "Invalid Request: missing method");
  }
  // Any notification: accepted, never answered.
  if (!("id" in message)) return { status: 202, body: null };
  if (!(typeof id === "string" || (typeof id === "number" && Number.isInteger(id)))) {
    return error(400, null, ERR.invalidRequest, "Invalid Request: id must be a string or an integer");
  }
  if (message.params !== undefined && !isObject(message.params)) {
    return error(400, id, ERR.invalidRequest, "Invalid Request: params must be an object");
  }
  const params = (message.params ?? {}) as Record<string, unknown>;
  const meta = isObject(params._meta) ? params._meta : {};
  const metaVersion = meta[META_VERSION];
  const headerVersion = headers?.get("MCP-Protocol-Version") ?? null;

  const modern =
    method !== "initialize" &&
    (metaVersion !== undefined || (headerVersion !== null && !LEGACY_VERSIONS.includes(headerVersion)));

  if (modern) {
    if (typeof metaVersion !== "string") {
      return error(400, id, ERR.invalidParams, `Missing _meta["${META_VERSION}"]`);
    }
    if (headers && headerVersion === null) {
      return error(400, id, ERR.headerMismatch, "Header mismatch: MCP-Protocol-Version header is required");
    }
    if (headers && headerVersion !== metaVersion) {
      return error(400, id, ERR.headerMismatch, `Header mismatch: MCP-Protocol-Version '${headerVersion}' does not match body '${metaVersion}'`);
    }
    if (!MODERN_VERSIONS.includes(metaVersion)) {
      return error(400, id, ERR.unsupportedVersion, "Unsupported protocol version", {
        supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
        requested: metaVersion,
      });
    }
    if (!isObject(meta[META_CAPABILITIES])) {
      return error(400, id, ERR.invalidParams, `Missing _meta["${META_CAPABILITIES}"]`);
    }
    if (headers) {
      const headerMethod = headers.get("Mcp-Method");
      if (headerMethod !== method) {
        return error(400, id, ERR.headerMismatch, `Header mismatch: Mcp-Method '${headerMethod ?? ""}' does not match body '${method}'`);
      }
      if (method === "tools/call") {
        const headerName = headers.get("Mcp-Name");
        if (headerName === null || decodeHeaderValue(headerName) !== params.name) {
          return error(400, id, ERR.headerMismatch, "Header mismatch: Mcp-Name does not match params.name");
        }
      }
    }
  } else if (headerVersion !== null && !LEGACY_VERSIONS.includes(headerVersion)) {
    return error(400, id, ERR.invalidRequest, `Unsupported MCP-Protocol-Version '${headerVersion}'`);
  }

  const reply = (result: Record<string, unknown>): RpcOutcome => ({
    status: 200,
    body: {
      jsonrpc: "2.0",
      id,
      result: modern ? { resultType: "complete", ...result, _meta: { [META_SERVER_INFO]: SERVER_INFO } } : result,
    },
  });

  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return reply({
        protocolVersion: LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "server/discover":
      return reply({
        supportedVersions: MODERN_VERSIONS,
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        ...CACHE_PUBLIC,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply(modern ? { tools: MCP_TOOLS, ...CACHE_PUBLIC } : { tools: MCP_TOOLS });
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string") return error(modern ? 400 : 200, id, ERR.invalidParams, "params.name is required");
      if (params.arguments !== undefined && !isObject(params.arguments)) {
        return error(modern ? 400 : 200, id, ERR.invalidParams, "params.arguments must be an object");
      }
      try {
        const result = await handleToolCall(env, user, name, (params.arguments ?? {}) as Record<string, unknown>);
        if (!result) return error(modern ? 400 : 200, id, ERR.invalidParams, `Unknown tool: ${name}`);
        return reply(result);
      } catch (err) {
        // Detail goes to the Worker's log; the caller gets nothing that names
        // a table or a query.
        console.error(JSON.stringify({ event: "tool_call_failed", tool: name, userId: user.userId, error: String(err) }));
        return error(200, id, ERR.internal, "Internal error");
      }
    }
    default:
      // Modern HTTP answers an unknown method with 404, which tells it apart
      // from a legacy server's 404 for a missing endpoint.
      return error(modern && headers ? 404 : 200, id, ERR.methodNotFound, `Method not found: ${method}`);
  }
}

/** Streamable HTTP (`POST /mcp`): one JSON-RPC message per request. */
export async function handleMcpPost(env: Env, user: AuthUser, request: Request, bodyText: string): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: ERR.parse, message: "Parse error" } });
  }
  if (Array.isArray(parsed)) {
    return json(400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: ERR.invalidRequest, message: "Invalid Request: JSON-RPC batches are not supported" },
    });
  }
  const outcome = await processMessage(env, user, parsed, request.headers);
  if (!outcome.body) return new Response(null, { status: 202 });
  return json(outcome.status, outcome.body);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
