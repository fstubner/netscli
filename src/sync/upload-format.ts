/**
 * What a message looks like on its way to xtctx cloud.
 *
 * The limits mirror the server's (cloud/src/db.ts `LIMITS`). The client stays
 * under them on its own, so a refusal only happens when the two disagree,
 * and then the sync skips the one message and carries on.
 */
export const UPLOAD_LIMITS = {
  maxBodyBytes: 1024 * 1024,
  maxMessageBytes: 64 * 1024,
  maxMetadataBytes: 4 * 1024,
  maxSessionsPerRequest: 10,
  maxMessagesPerRequest: 500,
  /** Requests are packed to this, leaving room for the envelope under maxBodyBytes. */
  targetBodyBytes: 768 * 1024,
} as const;

/**
 * Metadata fields that may leave the machine. Everything else is dropped:
 * `sourcePath` (an absolute transcript or working-directory path),
 * `referencedFiles` (paths), and anything a scraper adds later until it is
 * looked at and listed here.
 *
 * Looked at and decided: `subagent` (a flag) and `subagentType` (the kind of
 * subagent Cursor names, such as "explore") are sent, so a reader of the
 * cloud copy can tell a subagent's turns from the main agent's, as the local
 * index can. `parentToolCallId` (Copilot CLI) is not: it is an id into the
 * tool's own records, which the cloud does not have, so it says nothing there.
 */
const UPLOADED_METADATA_KEYS = [
  "messageIndex",
  "tokenEstimate",
  "toolCalls",
  "toolName",
  "model",
  "stepType",
  "artifactType",
  "artifactName",
  "sessionType",
  "approvalMode",
  "sandboxed",
  "layer",
  "costUsd",
  "gitBranch",
  "gitCommit",
  "subagent",
  "subagentType",
] as const;

export const UPLOADED_METADATA_FIELDS: readonly string[] = UPLOADED_METADATA_KEYS;

const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/]|file:)/;

function safeValue(value: unknown): unknown {
  if (typeof value === "string") return ABSOLUTE_PATH.test(value.trim()) ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const kept = value.map(safeValue).filter((v) => v !== undefined && typeof v !== "object");
    return kept.length > 0 ? kept : undefined;
  }
  return undefined; // nested objects are not uploaded
}

/** The stored metadata JSON reduced to UPLOADED_METADATA_FIELDS, with no absolute paths. */
export function sanitizeMetadata(json: string | null | undefined): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json ?? "{}");
  } catch {
    return "{}";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "{}";
  const out: Record<string, unknown> = {};
  for (const key of UPLOADED_METADATA_KEYS) {
    const value = safeValue((parsed as Record<string, unknown>)[key]);
    if (value !== undefined) out[key] = value;
  }
  const text = JSON.stringify(out);
  return Buffer.byteLength(text) > UPLOAD_LIMITS.maxMetadataBytes ? "{}" : text;
}

/** Content cut to the server's per-message limit, with a marker saying so. */
export function fitContent(content: string): string {
  const bytes = Buffer.byteLength(content);
  if (bytes <= UPLOAD_LIMITS.maxMessageBytes) return content;
  const marker = `\n\n[xtctx: truncated for upload; the original is ${bytes} bytes]`;
  // A few bytes of slack: cutting inside a multi-byte character leaves a
  // replacement character, which can be longer than what it replaced.
  const keep = UPLOAD_LIMITS.maxMessageBytes - Buffer.byteLength(marker) - 4;
  return Buffer.from(content, "utf-8").subarray(0, keep).toString("utf-8") + marker;
}
