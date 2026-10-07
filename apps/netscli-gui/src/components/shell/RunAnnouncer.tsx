import { useEffect, useRef, useState } from 'react';

import { resultSummary } from '../../tools/presentation';
import { TOOL_CONFIG } from '../../tools/registry';
import type { WorkspaceTab } from '../../tools/types';

/**
 * Says what the active tab's run is doing to people who cannot see it.
 *
 * Until this existed the main flow was silent to a screen reader at stock
 * settings. The progress bar has no live text, and a result arriving in the
 * table is only a completion signal if you can see the table. The toasts that
 * are live regions are opt-in and off by default, so they could not be the
 * answer. A failed run is not announced here: the error strip is a `role=alert`
 * and says it itself.
 *
 * Deliberately sparse. A run says when it starts, at each quarter of the way
 * through (at most three times for each step it has), and when it ends. A
 * progress event every 100 ms read aloud would be unusable.
 *
 * It only follows the tab being looked at. A run finishing in a background tab
 * is what the "operation toasts" setting is for.
 */
export function RunAnnouncer({ tab }: { tab: WorkspaceTab | undefined }) {
  const [message, setMessage] = useState('');
  const before = useRef<RunSnapshot | null>(null);

  useEffect(() => {
    const next = announcement(before.current, tab);
    before.current = next.snapshot;
    if (next.message) setMessage(next.message);
  }, [tab]);

  // Rendered even when empty. A screen reader only announces changes inside a
  // live region that already existed, which is why ToastHost does the same.
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

interface RunSnapshot {
  tabId: string;
  busy: boolean;
  /** How many quarters of the current step are done, 0 to 3. */
  quarter: number;
}

/** What to say now, given how the tab looked the last time this was asked. */
function announcement(
  before: RunSnapshot | null,
  tab: WorkspaceTab | undefined,
): { snapshot: RunSnapshot | null; message: string | null } {
  if (!tab) return { snapshot: null, message: null };
  const snapshot = snapshotOf(tab);
  // The first sight of a tab, or a switch to another one. Nothing has
  // happened that the person did not just do themselves.
  if (!before || before.tabId !== tab.id) return { snapshot, message: null };

  const label = TOOL_CONFIG[tab.kind].label;
  if (!before.busy && tab.busy) return { snapshot, message: `${label} started` };

  if (before.busy && !tab.busy) {
    // The error strip announces its own message.
    if (tab.error) return { snapshot, message: null };
    // Stop clears the result of every tool except trace, which keeps the hops
    // it had printed, so a stopped trace reads as complete with those hops.
    return {
      snapshot,
      message: tab.result ? `${label} complete. ${resultSummary(tab.result)}` : `${label} stopped`,
    };
  }

  // Only a step forward is news. A run with two steps (discover probes, then
  // resolves names) restarts its count for the second, which is not one.
  if (tab.busy && snapshot.quarter > before.quarter) {
    return { snapshot, message: `${label}, ${snapshot.quarter * 25}% complete` };
  }
  return { snapshot, message: null };
}

function snapshotOf(tab: WorkspaceTab): RunSnapshot {
  const total = tab.progress?.total ?? 0;
  const completed = tab.progress?.completed ?? 0;
  // A trace reports the hop it has reached out of the maximum, and almost
  // always ends well short of it, so a percentage would say something false.
  const counted = tab.busy && total > 0 && tab.kind !== 'trace';
  return {
    tabId: tab.id,
    busy: tab.busy,
    quarter: counted ? Math.min(3, Math.floor((completed / total) * 4)) : 0,
  };
}
