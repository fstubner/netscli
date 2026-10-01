export interface Env {
  DB: D1Database;
  /** Holds the open baseline-MCP SSE streams; see sse-session.ts. */
  SSE: DurableObjectNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Required. Requests are refused with a 500 while it is unset. */
  JWT_SECRET?: string;
  /** Comma-separated browser origins to send CORS headers to. Unset means none. */
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
}

export interface AuthUser {
  userId: string;
  username: string;
  deviceId?: string;
}

export interface StreamTurnDelta {
  deviceId: string;
  deviceName?: string;
  tool: string;
  sourceSessionId: string;
  repoUrl: string;
  projectRoot: string;
  gitBranch?: string;
  gitCommit?: string;
  timestamp: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  messageIndex: number;
  contentHash: string;
  metadataJson?: string;
  sourcePointer?: string;
  preview?: string;
  status?: "active" | "idle" | "closed";
}

export interface SessionRecord {
  session_ref: string;
  user_id: string;
  device_id: string;
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
  source_path: string | null;
  status: string;
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
  source_pointer: string | null;
  indexed_at: string;
}
