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
      isTabActive: () => true,
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
      isTabActive: () => true,
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
      isTabActive: () => true,
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
      isTabActive: () => true,
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

// Completion toasts are scoped to tabs the user is not looking at.
//
// The rule: on the visible tab the result landing in the table already says
// the run finished, so a toast repeats what is on screen. On a background
// tab nothing else says so, and a long scan finishing unannounced is the
// case worth reporting. Failure is not subject to this -- covered above,
// where the table stays empty and the reason has to surface either way.
describe('completion toasts', () => {
  async function runScan(isTabActive: (tabId: string) => boolean) {
    const tab = createTab('scan');
    tab.form.host = '127.0.0.1';
    const showToast = vi.fn();

    await runWorkspaceTab({
      activeOps: { current: {} as Record<string, string> },
      isTabActive,
      maxConcurrentProbes: 256,
      patchTab: vi.fn(),
      persistentHistory: false,
      setHistory: vi.fn(),
      showToast,
      tab,
    });

    return { showToast, tabId: tab.id };
  }

  it('stays quiet when the finished tab is the one on screen', async () => {
    const { executeTool } = await import('./toolExecution');
    vi.mocked(executeTool).mockResolvedValue(scanResult());

    const { showToast } = await runScan(() => true);

    expect(showToast).not.toHaveBeenCalled();
  });

  it('announces a run that finished on a tab the user had switched away from', async () => {
    const { executeTool } = await import('./toolExecution');
    vi.mocked(executeTool).mockResolvedValue(scanResult());

    const { showToast, tabId } = await runScan(() => false);

    // `tabId` is what gives the toast its "Open tab" action in ToastHost.
    // Without it the toast names a tab the user cannot reach from it.
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('complete'),
        kind: 'operation',
        tabId,
      }),
    );
  });

  it('reads the active tab at completion, not when the run started', async () => {
    // The case the ref in useWorkspace exists for: the user starts a scan
    // and switches away while it runs. A value captured when the run began
    // would still see the tab as active and say nothing.
    const { executeTool } = await import('./toolExecution');
    let active = true;
    vi.mocked(executeTool).mockImplementation(async () => {
      active = false;
      return scanResult();
    });

    const { showToast } = await runScan(() => active);

    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
