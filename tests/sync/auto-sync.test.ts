import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAutoSync } from "@xtctx/sync/auto-sync";
import { NotOptedInError, type DiffSyncResult } from "@xtctx/sync/diff-sync";

const result = (n: number): DiffSyncResult => ({ syncedCount: n, sessionCount: n ? 1 : 0, skipped: [], upToDate: n === 0, busy: false });

describe("auto sync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("syncs on an interval and uploads once more on stop", async () => {
    const sync = vi.fn(async () => result(0));
    const sink = startAutoSync({ projectRoot: "/p", log: () => {}, intervalMs: 1000, sync });

    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sync).toHaveBeenCalledTimes(3);

    await sink.stop();
    expect(sync).toHaveBeenCalledTimes(4); // the flush
    await vi.advanceTimersByTimeAsync(5000);
    expect(sync).toHaveBeenCalledTimes(4); // and then nothing
  });

  it("never runs two syncs at once", async () => {
    let running = 0;
    let overlapped = false;
    const sync = vi.fn(async () => {
      running++;
      overlapped ||= running > 1;
      await new Promise((r) => setTimeout(r, 2500)); // slower than the interval
      running--;
      return result(0);
    });
    const sink = startAutoSync({ projectRoot: "/p", log: () => {}, intervalMs: 1000, sync });

    await vi.advanceTimersByTimeAsync(10_000);
    const stopped = sink.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await stopped;
    expect(overlapped).toBe(false);
  });

  it("is quiet when the project is not opted in, and says a real failure once", async () => {
    const lines: string[] = [];
    let mode: "optout" | "boom" = "optout";
    const sync = vi.fn(async () => {
      throw mode === "optout" ? new NotOptedInError() : new Error("boom");
    });
    const sink = startAutoSync({ projectRoot: "/p", log: (l) => lines.push(l), intervalMs: 1000, sync });

    await vi.advanceTimersByTimeAsync(3000);
    expect(lines).toEqual([]);

    mode = "boom";
    await vi.advanceTimersByTimeAsync(3000);
    expect(lines).toEqual(["xtctx: cloud sync failed: boom"]);
    await sink.stop();
  });

  it("gives up on a flush that hangs instead of holding shutdown", async () => {
    const sync = vi.fn(() => new Promise<DiffSyncResult>(() => {}));
    const sink = startAutoSync({ projectRoot: "/p", log: () => {}, intervalMs: 60_000, flushTimeoutMs: 500, sync });

    const stopped = sink.stop();
    await vi.advanceTimersByTimeAsync(500);
    await expect(stopped).resolves.toBeUndefined();
  });
});
