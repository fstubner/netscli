import type { Env, AuthUser } from "./types.js";
import { getRecentSessions, getSessionMessages } from "./db.js";

export const MCP_TOOLS = [
  {
    name: "xtctx_recent_sessions",
    description: "List recent transcript sessions across all your local devices for this project. Call this when you need cross-device or cross-tool handoff context.",
    inputSchema: {
      type: "object",
      properties: {
        repo_url: { type: "string", description: "Optional git repository URL (e.g. github.com/user/repo) to filter sessions" },
        limit: { type: "number", description: "Max sessions to return. Default: 5" },
        tool_filter: {
          type: "array",
          items: { type: "string" },
          description: "Optional tool ids: claude-code, antigravity, cursor, copilot, codex"
        },
        branch_filter: {
          type: "array",
          items: { type: "string" },
          description: "Optional git branches to include"
        },
        format: {
          type: "string",
          enum: ["markdown", "json"],
          description: "Response format. Default: markdown"
        }
      }
    }
  },
  {
    name: "xtctx_session_detail",
    description: "Return raw messages from a session_ref returned by xtctx_recent_sessions.",
    inputSchema: {
      type: "object",
      required: ["session_ref"],
      properties: {
        session_ref: { type: "string", description: "Session reference string" },
        offset: { type: "number", description: "Message offset for pagination" },
        limit: { type: "number", description: "Max messages to return. Default: 50" }
      }
    }
  }
];

export async function handleToolCall(
  env: Env,
  user: AuthUser,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (name === "xtctx_recent_sessions") {
    const sessions = await getRecentSessions(env, user.userId, {
      repoUrl: typeof args.repo_url === "string" ? args.repo_url : undefined,
      limit: typeof args.limit === "number" ? args.limit : 5,
      toolFilter: Array.isArray(args.tool_filter) ? (args.tool_filter as string[]) : undefined,
      branchFilter: Array.isArray(args.branch_filter) ? (args.branch_filter as string[]) : undefined,
    });

    if (args.format === "json") {
      return {
        content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }]
      };
    }

    if (sessions.length === 0) {
      return {
        content: [{ type: "text", text: "No recent cross-device sessions found for this project." }]
      };
    }

    const lines: string[] = ["## Recent Cross-Device Sessions\n"];
    for (const s of sessions) {
      const branchInfo = s.git_branch ? ` (branch: \`${s.git_branch}\`)` : "";
      const deviceTag = `[Device: ${s.device_id}]`;
      const timeStr = new Date(s.last_activity_at).toLocaleString();
      lines.push(
        `- **${s.tool}** on **${deviceTag}**${branchInfo}\n` +
        `  - Last active: ${timeStr} (${s.message_count} messages)\n` +
        `  - Preview: ${s.preview || "No preview"}\n` +
        `  - Ref: \`${s.session_ref}\`\n`
      );
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }]
    };
  }

  if (name === "xtctx_session_detail") {
    const sessionRef = String(args.session_ref);
    const { session, messages } = await getSessionMessages(env, user.userId, sessionRef, {
      offset: typeof args.offset === "number" ? args.offset : 0,
      limit: typeof args.limit === "number" ? args.limit : 50,
    });

    if (!session) {
      return {
        isError: true,
        content: [{ type: "text", text: `Session '${sessionRef}' not found.` }]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ session, messages }, null, 2)
        }
      ]
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

/**
 * Handle incoming JSON-RPC payload for both modern (2026-07-28) and baseline (2024-11-05).
 */
export async function processJsonRpc(
  env: Env,
  user: AuthUser,
  body: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const { id, method, params } = body as { id?: unknown; method: string; params?: Record<string, unknown> };

  if (method === "initialize") {
    // Protocol negotiation: accept client's requested version or default to baseline
    const clientVersion = (params?.protocolVersion as string) || "2024-11-05";
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: clientVersion === "2026-07-28" ? "2026-07-28" : "2024-11-05",
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: {
          name: "xtctx-cloud",
          version: "0.22.0"
        }
      }
    };
  }

  if (method === "notifications/initialized") {
    // Notification, no response required
    return null;
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: MCP_TOOLS
      }
    };
  }

  if (method === "tools/call") {
    const toolName = (params?.name as string) || "";
    const toolArgs = (params?.arguments as Record<string, unknown>) || {};
    try {
      const result = await handleToolCall(env, user, toolName, toolArgs);
      return {
        jsonrpc: "2.0",
        id,
        result
      };
    } catch (err: unknown) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : String(err)
        }
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`
    }
  };
}
