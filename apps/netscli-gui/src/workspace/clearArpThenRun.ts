import * as netscli from '../services/netscli';

/**
 * Flush the OS neighbour cache, then run the tab.
 *
 * A failed clear stops the run rather than continuing without it. The two
 * outcomes are indistinguishable on screen -- discover reports hosts either
 * way -- so carrying on would quietly hand back the stale neighbours the user
 * asked to be rid of, and say nothing about it.
 *
 * The failure goes to the tab's error strip, not a toast. Toasts are
 * preference-gated and default to off, so reporting it that way made a failed
 * clear silent: the button appeared to do nothing at all. Measured in the
 * running app before this was changed.
 *
 * Takes an optional id so the caller can hand over `activeTab?.id` directly
 * rather than guarding at every call site.
 */
export async function clearArpThenRun(
  tabId: string | undefined,
  run: (tabId: string) => void,
  reportError: (tabId: string, message: string) => void,
): Promise<void> {
  if (!tabId) return;
  try {
    await netscli.clearArpTable();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // No prefix of our own: the core error already opens with "Failed to
    // clear ARP table", and stacking another produced a message that said it
    // three times before reaching the useful part.
    reportError(tabId, message);
    return;
  }
  run(tabId);
}
