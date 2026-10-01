/**
 * What the MCP server does in the background after it starts.
 *
 * This logic lived in `cli/index.ts`, which runs `main()` on import, so no test
 * could reach it — and a mutation sweep found three changes to it that the
 * whole suite let through: ignoring the drain budget, calibrating with
 * embeddings disabled, and (found by review rather than mutation) an ordering
 * that meant calibration never applied to the session that ran it.
 */
import { describe, expect, it } from "vitest";
import { CalibrationBusyError, type DeviceVerdict } from "@xtctx/handoff/device";
import type { HandoffStatus, SessionService } from "@xtctx/handoff/types";
import { runBackgroundWork } from "@xtctx/runtime/background";

const VERDICT: DeviceVerdict = {
  device: "dml",
  measured: [
    { device: "cpu", msPerSegment: 20 },
    { device: "dml", msPerSegment: 3 },
  ],
  fingerprint: "test",
  measuredAt: "2026-09-23T00:00:00.000Z",
};

/**
 * Records the order things happen in. Backlog of 1,000 windows at the given
 * per-window rate, so the caller decides whether it fits the budget.
 */
function fakeSessions(msPerUnit: number | null): {
  sessions: SessionService;
  events: string[];
  deferred: Array<Promise<string | undefined>>;
} {
  const events: string[] = [];
  const deferred: Array<Promise<string | undefined>> = [];
  const status = {
    retrieval_units: 1000,
    vectorized_units: 0,
    vector_ms_per_unit: msPerUnit,
    vector_segment_backlog: 0,
    vector_ms_per_segment: null,
  } as unknown as HandoffStatus;

  const sessions = {
    async listRecentSessions() {
      events.push("scan");
      return [];
    },
    async whenScanSettled() {
      events.push("settled");
    },
    async getStatus() {
      return status;
    },
    async embedBacklog() {
      events.push("drain");
      return 0;
    },
    deferEmbeddingDeviceUntil(device: Promise<string | undefined>) {
      events.push("defer");
      deferred.push(device);
    },
  } as unknown as SessionService;

  return { sessions, events, deferred };
}

describe("the server's background work", () => {
  it("defers the model load to calibration BEFORE scanning", async () => {
    // Scanning first is what broke this: every scan starts the model load.
    const { sessions, events, deferred } = fakeSessions(50);

    await runBackgroundWork({
      sessions,
      env: {},
      localEmbeddings: true,
      readVerdict: async () => null,
      calibrate: async () => {
        events.push("calibrate");
        return VERDICT;
      },
      log: () => {},
    });

    expect(events.indexOf("defer")).toBeLessThan(events.indexOf("scan"));
    expect(events.indexOf("calibrate")).toBeLessThan(events.indexOf("scan"));
    expect(await deferred[0]).toBe("dml");
  });

  it("does not calibrate when embeddings are switched off", async () => {
    // Missed twice, in two places, in two days.
    const { sessions, events } = fakeSessions(50);
    let calibrated = false;

    await runBackgroundWork({
      sessions,
      env: { XTCTX_DISABLE_EMBEDDINGS: "1" },
      readVerdict: async () => null,
      calibrate: async () => {
        calibrated = true;
        return VERDICT;
      },
      log: () => {},
    });

    expect(calibrated).toBe(false);
    expect(events).not.toContain("defer");
  });

  it("does not calibrate when the local model is not enabled", async () => {
    // The default state of an install: the model is an add-on, so there is
    // nothing to time. Calibrating loads the model in a worker per device.
    const { sessions, events } = fakeSessions(50);
    let calibrated = false;

    await runBackgroundWork({
      sessions,
      env: {},
      localEmbeddings: false,
      readVerdict: async () => null,
      calibrate: async () => {
        calibrated = true;
        return VERDICT;
      },
      log: () => {},
    });

    expect(calibrated).toBe(false);
    expect(events).not.toContain("defer");
    // The scan still runs: keyword search needs the index either way.
    expect(events).toContain("scan");
  });

  it("does not calibrate a machine that already has a verdict", async () => {
    const { sessions } = fakeSessions(50);
    let calibrated = false;

    await runBackgroundWork({
      sessions,
      env: {},
      localEmbeddings: true,
      readVerdict: async () => VERDICT,
      calibrate: async () => {
        calibrated = true;
        return VERDICT;
      },
      log: () => {},
    });

    expect(calibrated).toBe(false);
  });

  it("drains a backlog that fits the budget", async () => {
    // 1,000 windows at 50ms is under a minute.
    const { sessions, events } = fakeSessions(50);

    await runBackgroundWork({ sessions, env: {}, localEmbeddings: true, readVerdict: async () => VERDICT, log: () => {} });

    expect(events).toContain("drain");
  });

  it("leaves a backlog that does not fit the budget alone", async () => {
    // 1,000 windows at 5s each is over an hour — the CPU case the budget is for.
    const { sessions, events } = fakeSessions(5_000);

    await runBackgroundWork({ sessions, env: {}, localEmbeddings: true, readVerdict: async () => VERDICT, log: () => {} });

    expect(events).not.toContain("drain");
  });

  it("does not drain when no rate has ever been measured", async () => {
    const { sessions, events } = fakeSessions(null);

    await runBackgroundWork({ sessions, env: {}, localEmbeddings: true, readVerdict: async () => VERDICT, log: () => {} });

    expect(events).not.toContain("drain");
  });

  it("stays quiet when another server holds the calibration lock", async () => {
    // The ordinary case on a fresh machine with several agents starting at once.
    const { sessions, events } = fakeSessions(50);
    const lines: string[] = [];

    await runBackgroundWork({
      sessions,
      env: {},
      localEmbeddings: true,
      readVerdict: async () => null,
      calibrate: async () => {
        throw new CalibrationBusyError();
      },
      log: (line) => lines.push(line),
    });

    expect(lines).toEqual([]);
    expect(events).toContain("scan");
  });

  it("reports a failure instead of swallowing it", async () => {
    // Background failures used to vanish into a bare catch.
    const { sessions } = fakeSessions(50);
    (sessions as { embedBacklog: () => Promise<number> }).embedBacklog = async () => {
      throw new Error("endpoint returned HTTP 401");
    };
    const lines: string[] = [];

    await runBackgroundWork({
      sessions,
      env: {},
      localEmbeddings: true,
      readVerdict: async () => VERDICT,
      log: (line) => lines.push(line),
    });

    expect(lines.join("\n")).toMatch(/HTTP 401/);
  });
});
