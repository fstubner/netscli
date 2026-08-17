import { onDispose } from './docs-header-disposal';

/**
 * Arrow-key navigation for the docs search results.
 *
 * Pagefind's default UI leaves focus in the input and does nothing with
 * ArrowDown/ArrowUp, so the results were reachable only by tabbing. Tab and
 * Enter did work — search was usable — but the down arrow is the key almost
 * everyone reaches for first, and pressing it appeared to do nothing at all.
 *
 * This moves real DOM focus rather than painting a highlight and tracking
 * `aria-activedescendant`. The results are anchors, so focus gets Enter,
 * middle-click and screen-reader announcement for free, and there is no
 * second notion of "selected" to keep in sync with the rendered list.
 *
 * Results are queried on every keypress. Pagefind re-renders the list as the
 * query changes, so any cached node reference would be stale by the next
 * keystroke.
 */
const RESULT_SELECTOR = '.pagefind-ui__result-link';
const INPUT_SELECTOR = '.pagefind-ui__search-input';

export function initDocsSearchKeys(): void {
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    const dialog = document.querySelector<HTMLDialogElement>('site-search dialog[open]');
    if (!dialog) return;

    const target = event.target;
    if (!(target instanceof HTMLElement) || !dialog.contains(target)) return;

    const input = dialog.querySelector<HTMLInputElement>(INPUT_SELECTOR);
    const results = [...dialog.querySelectorAll<HTMLAnchorElement>(RESULT_SELECTOR)];
    if (results.length === 0) return;

    const index = results.indexOf(target.closest<HTMLAnchorElement>(RESULT_SELECTOR) as HTMLAnchorElement);
    const onInput = target === input;

    // Only act from the input or from a result. Anything else in the dialog
    // (the close button, filters) keeps its native behaviour.
    if (!onInput && index === -1) return;

    let next: HTMLElement | null = null;
    if (event.key === 'ArrowDown') {
      next = onInput ? results[0] : (results[index + 1] ?? results[0]);
    } else if (onInput) {
      // Up from the input wraps to the last result, matching how most
      // command palettes behave.
      next = results[results.length - 1];
    } else {
      // Up from the first result returns to the input, so the query is
      // always one keypress away rather than needing Shift+Tab.
      next = index === 0 ? input : (results[index - 1] ?? input);
    }

    if (!next) return;
    event.preventDefault();
    next.focus();
    if (next !== input) next.scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('keydown', handleKeyDown);
  onDispose(() => document.removeEventListener('keydown', handleKeyDown));
}
