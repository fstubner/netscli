import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  DB: D1Database;
  /** Grants, OAuth tokens and registered clients; owned by workers-oauth-provider. */
  OAUTH_KV: KVNamespace;
  /** Set by workers-oauth-provider before a handler runs. */
  OAUTH_PROVIDER?: OAuthHelpers;
  /** Holds the open baseline-MCP SSE streams; see sse-session.ts. */
  SSE: DurableObjectNamespace;
  /**
   * The canonical origin MCP clients reach, e.g. "https://mcp.xtctx.com".
   * The MCP resource is `${PUBLIC_URL}/mcp`, and every token is bound to it.
   */
  PUBLIC_URL: string;
  GITHUB_CLIENT_ID: string;
  /** Needed only for the browser sign-in (`/authorize`); the CLI's device flow works without it. */
  GITHUB_CLIENT_SECRET?: string;
  /** Required. Requests are refused with a 500 while it is unset. */
  JWT_SECRET?: string;
  /**
   * Comma-separated numeric GitHub user ids allowed to sign in. Unset or empty
   * means nobody: the server fails closed.
   */
  ALLOWED_GITHUB_IDS?: string;
  /** Comma-separated browser origins to send CORS headers to. Unset means none. */
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
}

export interface AuthUser {
  userId: string;
  username: string;
  deviceId?: string;
}

/** The MCP tools. */
export const SCOPE_READ = "read";
/** POST /api/stream. Only the CLI's own login carries it. */
export const SCOPE_SYNC_WRITE = "sync:write";
/** DELETE /api/me. Only the CLI's own login carries it. */
export const SCOPE_ACCOUNT_DELETE = "account:delete";

export interface SessionRecord {
  session_ref: string;
  user_id: string;
  device_id: string;
  device_name?: string | null;
  tool: string;
  source_session_id: string;
  repo_url: string;
  project_root: string;
  git_branch: string | null;
  git_commit: string | null;
  started_at: string;
  last_activity_at: string;
  message_count: number;
  preview: string | null;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  session_ref: string;
  tool: string;
  source_session_id: string;
  timestamp: string;
  role: string;
  content: string;
  message_index: number;
  content_hash: string;
  metadata_json: string;
  indexed_at: string;
}
