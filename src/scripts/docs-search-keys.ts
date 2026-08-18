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

/**
 * Two things Pagefind's default UI does not do: say anything when its own
 * assets cannot be fetched, and give focus back when the dialog closes.
 *
 * Offline, the index request never resolves, so the drawer sits on
 * "Searching for <query>…" indefinitely -- measured at 16s with no error, no
 * retry and no way to tell a slow search from a dead one. And closing the
 * dialog with Escape dropped focus to <body>, so a keyboard user landed at
 * the top of the document instead of back on the button they opened.
 */
const MESSAGE_SELECTOR = '.pagefind-ui__message';
const SEARCH_TIMEOUT_MS = 8000;
const OFFLINE_NOTE = 'netscli-search-offline';

export function initDocsSearchResilience(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let opener: HTMLElement | null = null;

  const clearNote = (dialog: Element) => {
    dialog.querySelector(`.${OFFLINE_NOTE}`)?.remove();
  };

  const showNote = (dialog: Element) => {
    if (dialog.querySelector(`.${OFFLINE_NOTE}`)) return;
    const message = dialog.querySelector(MESSAGE_SELECTOR);
    if (!message) return;
    const note = document.createElement('p');
    note.className = OFFLINE_NOTE;
    note.setAttribute('role', 'status');
    note.textContent = navigator.onLine
      ? 'Search is not responding. Check your connection, then edit the query to try again.'
      : 'Search needs a connection and you appear to be offline. The pages themselves still work.';
    message.insertAdjacentElement('afterend', note);
  };

  const onInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(INPUT_SELECTOR)) return;
    const dialog = target.closest('dialog');
    if (!dialog) return;
    clearNote(dialog);
    if (timer) clearTimeout(timer);
    // Only complain if the drawer is still *searching* when the timer fires.
    // A slow-but-working search resolves and rewrites this message itself.
    timer = setTimeout(() => {
      const message = dialog.querySelector(MESSAGE_SELECTOR);
      if (message && /^\s*Searching/i.test(message.textContent ?? '')) showNote(dialog);
    }, SEARCH_TIMEOUT_MS);
  };

  const rememberOpener = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('button[data-open-modal]')) {
      opener = target.closest('button[data-open-modal]');
    }
  };

  const onClose = (event: Event) => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement)) return;
    clearNote(dialog);
    if (timer) clearTimeout(timer);
    // Native <dialog> restores focus to whatever was focused when it opened,
    // which here is nothing -- Starlight opens it from a keyboard shortcut as
    // well as a click. Put focus back on the trigger explicitly.
    if (opener?.isConnected) opener.focus();
  };

  document.addEventListener('input', onInput, true);
  document.addEventListener('click', rememberOpener, true);
  document.addEventListener('close', onClose, true);
  onDispose(() => {
    if (timer) clearTimeout(timer);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('click', rememberOpener, true);
    document.removeEventListener('close', onClose, true);
  });
}
