import { describe, expect, it, vi } from 'vitest';

import { createTab } from '../tools/registry';
import type { ToolResult } from '../types/app';
import { runWorkspaceTab } from './operations';

vi.mock('./toolExecution', () => ({
  executeTool: vi.fn(),
  validateTab: vi.fn(() => null),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function scanResult(): ToolResult {
  return { kind: 'scan', data: [] };
}

describe('runWorkspaceTab op-id race guard', () => {
  it('ignores a stale executeTool resolution once a newer run has started for the same tab', async () => {
    const { executeTool } = await import('./toolExecution');
    const first = deferred<ToolResult>();
    const second = deferred<ToolResult>();
    vi.mocked(executeTool).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const tab = createTab('scan');
    tab.form.host = '127.0.0.1';
    const activeOps = { current: {} as Record<string, string> };
    const patchTab = vi.fn();
    const setHistory = vi.fn();
    const showToast = vi.fn();

    const firstRun = runWorkspaceTab({
      activeOps,
      maxConcurrentProbes: 256,
      patchTab,
      persistentHistory: false,
      setHistory,
      showToast,
      tab,
    });

    // A second run starts for the same tab before the first has resolved,
    // simulating the user re-triggering the operation (or an auto-run
    // racing a manual run). This overwrites activeOps.current[tab.id].
    const secondRun = runWorkspaceTab({
      activeOps,
      maxConcurrentProbes: 256,
      patchTab,
      persistentHistory: false,
      setHistory,
      showToast,
      tab,
    });

    // Resolve the newer call first, then the stale one — the stale
    // resolution must not be allowed to patch the tab with its result.
    second.resolve(scanResult());
    await secondRun;
    patchTab.mockClear();

    first.resolve(scanResult());
    await firstRun;

    expect(patchTab).not.toHaveBeenCalledWith(tab.id, expect.objectContaining({ result: expect.anything() }));
  });

  it('applies the result when no newer run has superseded it', async () => {
    const { executeTool } = await import('./toolExecution');
    const result = scanResult();
    vi.mocked(executeTool).mockResolvedValue(result);

    const tab = createTab('scan');
    tab.form.host = '127.0.0.1';
    const activeOps = { current: {} as Record<string, string> };
    const patchTab = vi.fn();
    const setHistory = vi.fn();
    const showToast = vi.fn();

    await runWorkspaceTab({
      activeOps,
      maxConcurrentProbes: 256,
      patchTab,
      persistentHistory: false,
      setHistory,
      showToast,
      tab,
    });

    expect(patchTab).toHaveBeenCalledWith(tab.id, expect.objectContaining({ result, busy: false }));
    expect(activeOps.current[tab.id]).toBeUndefined();
  });

  it('clears busy state and shows an error toast when execution fails', async () => {
    const { executeTool } = await import('./toolExecution');
    vi.mocked(executeTool).mockRejectedValue(new Error('boom'));

    const tab = createTab('scan');
    tab.form.host = '127.0.0.1';
    const activeOps = { current: {} as Record<string, string> };
    const patchTab = vi.fn();
    const setHistory = vi.fn();
    const showToast = vi.fn();

    await runWorkspaceTab({
      activeOps,
      maxConcurrentProbes: 256,
      patchTab,
      persistentHistory: false,
      setHistory,
      showToast,
      tab,
    });

    expect(patchTab).toHaveBeenCalledWith(
      tab.id,
      expect.objectContaining({ error: 'boom', busy: false, result: null }),
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('failed: boom') }),
    );
  });
});
