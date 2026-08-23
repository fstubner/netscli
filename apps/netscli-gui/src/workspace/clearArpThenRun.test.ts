import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearArpThenRun } from './clearArpThenRun';

const clearArpTable = vi.hoisted(() => vi.fn());
vi.mock('../services/netscli', () => ({ clearArpTable }));

describe('clear ARP, then run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the tab once the cache is flushed', async () => {
    clearArpTable.mockResolvedValue(undefined);
    const run = vi.fn();

    await clearArpThenRun('tab-1', run, vi.fn());

    expect(clearArpTable).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('tab-1');
  });

  it('does not run when the cache could not be flushed', async () => {
    // The case worth pinning. Clearing needs administrator rights, and a
    // discover after a failed clear looks exactly like one after a successful
    // clear -- same table, same row count. Running anyway would hand back the
    // stale neighbours the user asked to be rid of, and say nothing.
    clearArpTable.mockRejectedValue(new Error('Failed to clear ARP table (run as admin?)'));
    const run = vi.fn();
    const reportError = vi.fn();

    await clearArpThenRun('tab-1', run, reportError);

    expect(run).not.toHaveBeenCalled();
    // The error strip, not a toast: toasts are preference-gated and default
    // to off, which made this failure completely silent in the running app.
    expect(reportError).toHaveBeenCalledWith('tab-1', 'Failed to clear ARP table (run as admin?)');
  });

  it('does nothing without a tab, rather than flushing the cache for no reason', async () => {
    const run = vi.fn();

    await clearArpThenRun(undefined, run, vi.fn());

    expect(clearArpTable).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
