import { accountKey, readAccountState } from "./state.js";
import { EnvCredentialsRefusedError, loadSavedCredentials, resolveUploadCredentials } from "./client.js";
import { isOptedIn } from "./consent.js";

/**
 * Cloud sync, as lines for a status report: whether this project uploads,
 * as whom, and how the last attempt went. Reads files in ~/.xtctx only; it
 * never calls the server.
 */
export async function describeCloudSync(projectRoot: string): Promise<string[]> {
  const optedIn = await isOptedIn(projectRoot);
  const saved = await loadSavedCredentials();
  let effective = saved;
  let envProblem: string | undefined;
  try {
    effective = await resolveUploadCredentials();
  } catch (err) {
    if (err instanceof EnvCredentialsRefusedError) envProblem = err.message;
    else throw err;
  }

  if (!optedIn) {
    return [`off for this project${effective ? ` (logged in as ${effective.user.username})` : ""}; \`xtctx sync enable\` turns it on`];
  }
  if (envProblem) return ["on, but NOT uploading:", envProblem];
  if (!effective) return ["on, but NOT uploading: not logged in (run `xtctx login`)"];

  const state = await readAccountState(projectRoot, accountKey(effective.user.id, effective.syncUrl));
  const lines = [`on; uploading as ${effective.user.username} to ${effective.syncUrl}, device "${effective.deviceName}"`];
  lines.push(`last upload: ${state.lastSuccessAt ?? "never"}`);
  if (state.lastError && (!state.lastSuccessAt || (state.lastErrorAt ?? "") > state.lastSuccessAt)) {
    lines.push(`last attempt FAILED at ${state.lastErrorAt}: ${state.lastError}`);
  }
  if (state.skipped.length > 0) {
    lines.push(`${state.skipped.length} message(s) skipped as too large for the server:`);
    for (const s of state.skipped.slice(-5)) lines.push(`  ${s.sessionRef} ${s.messageId}: ${s.reason}`);
  }
  return lines;
}
