// Cancelling a run used to be able to lie in two different directions.
//
// F1: the in-flight guard was deleted *after* awaiting the backend, so a run
// that finished inside that await still matched its own id, took the success
// path, and wrote a result and a history entry for a run the user had stopped.
//
// F2: the backend call was `.catch(() => undefined)`. A refused cancel still
// cleared `busy` and dropped the op id, so the operation kept running with
// nothing on screen saying so and no id left to cancel it with.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelWorkspaceTab } from './operations';

const cancelOperation = vi.hoisted(() => vi.fn());
vi.mock('../services/netscli', () => ({ cancelOperation }));
vi.mock('../services/env', () => ({ isTauri: () => true }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('cancelling a run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops claiming the run before the backend has answered', async () => {
    const pending = deferred<void>();
    cancelOperation.mockReturnValue(pending.promise);
    const activeOps = { current: { 'tab-1': 'op-1' } };

    const done = cancelWorkspaceTab('tab-1', activeOps as never, vi.fn());
    await Promise.resolve();

    // The guard the completion path checks must already be gone: this is the
    // window a finishing run used to slip through and be shown as a success.
    expect(activeOps.current['tab-1']).toBeUndefined();

    pending.resolve();
    await done;
  });

  it('says so, and stays cancellable, when the backend refuses', async () => {
    cancelOperation.mockRejectedValue(new Error('operation not found'));
    const activeOps = { current: { 'tab-1': 'op-1' } };
    const patchTab = vi.fn();

    await cancelWorkspaceTab('tab-1', activeOps as never, patchTab);

    // The operation is still running, so the id has to come back or Stop can
    // never be pressed again.
    expect(activeOps.current['tab-1']).toBe('op-1');
    const patches = patchTab.mock.calls.map(([, patch]) => patch);
    const errors = patches.map((patch) => String(patch.error ?? ''));
    // What the user needs: the run may still be going, and Stop is worth
    // pressing again.
    expect(errors.some((message) => /still be running/i.test(message))).toBe(true);
    // And not the backend's own words. This path once put
    // "invalid args `opId` for command `cancel_operation`" on screen.
    expect(errors.some((message) => /operation not found/i.test(message))).toBe(false);
    // And it must not report the run as stopped when it is not.
    expect(patches.some((patch) => patch.busy === false)).toBe(false);
  });

  it('clears the tab when the cancel succeeds', async () => {
    cancelOperation.mockResolvedValue(undefined);
    const activeOps = { current: { 'tab-1': 'op-1' } };
    const patchTab = vi.fn();

    await cancelWorkspaceTab('tab-1', activeOps as never, patchTab);

    expect(activeOps.current['tab-1']).toBeUndefined();
    expect(patchTab).toHaveBeenCalledWith('tab-1', { busy: false, progress: null, error: null });
  });
});
