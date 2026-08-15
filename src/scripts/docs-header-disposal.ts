/**
 * Teardown registry for the docs header behaviours.
 *
 * `docs-header.ts` attaches three whole-document MutationObservers plus a set
 * of scroll/resize listeners, and previously disconnected none of them
 * (B-38). Today that only costs memory, because the module runs once per full
 * page load.
 *
 * It becomes a real leak the moment view transitions are enabled:
 * `initDocsHeader` re-runs on `astro:page-load`, so a second navigation would
 * stack a second full set of observers on top of the first — each with rAF
 * callbacks that themselves mutate the DOM.
 *
 * Registering teardown now means enabling `<ClientRouter />` later is a
 * one-line change rather than a debugging session.
 */
const disposers: Array<() => void> = [];

/** Register a teardown callback to run before the next page swap. */
export function onDispose(dispose: () => void): void {
  disposers.push(dispose);
}

/** Run and clear every registered teardown callback. */
export function disposeDocsHeader(): void {
  while (disposers.length > 0) {
    const dispose = disposers.pop();
    try {
      dispose?.();
    } catch {
      // One failed teardown must not block the rest.
    }
  }
}

let disposalRegistered = false;

/**
 * Arrange for teardown before a view transition swaps the document.
 *
 * `astro:before-swap` only fires when view transitions are active, so this is
 * inert on the current site and correct if that changes.
 */
export function registerDisposal(): void {
  if (disposalRegistered) return;
  disposalRegistered = true;
  document.addEventListener('astro:before-swap', disposeDocsHeader);
}
