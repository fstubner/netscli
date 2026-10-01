import {
  CalibrationBusyError,
  calibrateEmbeddingDevice,
  readDeviceVerdict,
  type DeviceVerdict,
} from "../handoff/device.js";
import type { SessionService } from "../handoff/types.js";
import { BACKGROUND_EMBED_BUDGET_MS, estimateVectorBacklog } from "../utils/duration.js";

/**
 * What the MCP server does in the background after it starts, with nobody
 * waiting on it.
 *
 * Lives here rather than in `cli/index.ts` so it can be tested. That file runs
 * `main()` on import, so nothing in it could be exercised by a test, and three
 * mutations to this exact logic — ignoring the drain budget, calibrating with
 * embeddings disabled, and the ordering that stopped calibration applying at
 * all — survived the whole suite.
 */
export interface BackgroundDeps {
  sessions: SessionService;
  readVerdict?: () => Promise<DeviceVerdict | null>;
  calibrate?: () => Promise<DeviceVerdict>;
  env?: NodeJS.ProcessEnv;
  /** Where background failures are reported; stderr in the real server. */
  log?: (line: string) => void;
}

/**
 * Calibrate if this machine never has, scan, then drain the vector backlog if
 * it fits the budget.
 *
 * ORDER IS THE WHOLE POINT. Calibration is started before the scan and handed
 * to the index as a promise the model's first load waits on. An earlier
 * version calibrated after the scan and tried to retarget the provider — but
 * every scan ends by starting the model load, so the retarget was refused on
 * every run and the verdict never applied to the session that measured it.
 * Deferring the load cannot lose that race, whoever asks for the model first.
 *
 * And awaiting calibration before the scan means the scan's own vectorizing
 * pass runs on the chosen device and records its per-segment rate — a real
 * measurement on the real path — which is then what the drain budget is judged
 * by. The previous version substituted calibration's own rate, which is the
 * fastest of three passes over uniform 1000-character segments and
 * systematically quicker than real windows.
 */
export async function runBackgroundWork(deps: BackgroundDeps): Promise<void> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  try {
    await calibrateFirstIfNeeded(deps, env, log);
    await deps.sessions.listRecentSessions(1);
    await deps.sessions.whenScanSettled();
    await drainIfAffordable(deps.sessions);
  } catch (error) {
    // Reported rather than swallowed. The drain records its own failure in
    // `embedding_error`; this line is for everything else, and for anyone
    // reading the server's stderr in their agent's MCP log.
    log(
      `xtctx: background indexing stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Measure this machine's embedding devices, once per machine, before any
 * model load.
 *
 * Not conditioned on a backlog, because at startup there is no way to know
 * one without first scanning — and scanning first is the ordering that broke
 * this. The verdict is per machine, and any configured project will embed.
 */
async function calibrateFirstIfNeeded(
  deps: BackgroundDeps,
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
): Promise<void> {
  // No model is ever loaded with this set, and calibration loads one per
  // device. This guard was missing twice, in two places, in two days.
  if (env.XTCTX_DISABLE_EMBEDDINGS === "1") {
    return;
  }
  const readVerdict = deps.readVerdict ?? (() => readDeviceVerdict());
  if (await readVerdict()) {
    return;
  }

  const calibrate = deps.calibrate ?? (() => calibrateEmbeddingDevice());
  const running = calibrate();
  deps.sessions.deferEmbeddingDeviceUntil?.(
    running.then((verdict) => verdict.device).catch(() => undefined),
  );

  try {
    await running;
  } catch (error) {
    // Another server holding the lock is the ordinary case on a fresh machine
    // with several agents starting at once, and says nothing is wrong. Anything
    // else is worth a line: this session embeds on the default device.
    if (!(error instanceof CalibrationBusyError)) {
      log(
        `xtctx: could not measure embedding devices, using the default: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Work the vector backlog down, when this machine's measured rate says the
 * remainder fits `BACKGROUND_EMBED_BUDGET_MS`.
 *
 * Until this existed nothing finished embedding a real history: searches
 * vectorize about sixteen windows a call, which by this project's own
 * measurement needs on the order of 570 searches for a 9,232-window project.
 * Bounded rather than unconditional, because unbounded background embedding on
 * a CPU takes nine to eleven of twenty-four cores for an hour.
 */
async function drainIfAffordable(sessions: SessionService): Promise<void> {
  if (!sessions.embedBacklog) {
    return;
  }
  const status = await sessions.getStatus();
  const { remaining, etaMs } = estimateVectorBacklog(
    status.retrieval_units,
    status.vectorized_units,
    status.vector_ms_per_unit,
    { backlog: status.vector_segment_backlog, msPerSegment: status.vector_ms_per_segment },
  );
  // No estimate means nothing has embedded yet on this machine, so there is no
  // measured rate to judge affordability by.
  if (remaining === 0 || etaMs === null || etaMs > BACKGROUND_EMBED_BUDGET_MS) {
    return;
  }
  await sessions.embedBacklog();
}
