import type { KeyboardEvent } from 'react';

import type { WorkspaceTab } from '../../tools/types';

/**
 * Keyboard behaviour for the workspace tab strip.
 *
 * H-3: the tabs were plain divs with an onClick — no role, no tabIndex, and
 * no tab-switching shortcut anywhere in the app — so they could not be
 * reached or operated by keyboard at all. `TabStrip` now renders them as a
 * tablist with a roving tabindex (only the active tab is in the tab order),
 * and this module supplies the movement.
 *
 * Split out of `TabStrip.tsx` to keep that file under the maintainability
 * cap. Lives next to it rather than in `hooks/` because it is specific to
 * this strip's roving-tabindex markup.
 *
 * Standard tablist pattern: arrows move between tabs and wrap at the ends,
 * Home/End jump to the ends, Delete closes, Enter/Space activate. The last
 * is needed because the tabs are divs, which — unlike buttons — do not fire
 * a click on Enter or Space.
 */
export function handleTabStripKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  index: number,
  tabs: WorkspaceTab[],
  onSelectTab: (tabId: string) => void,
  onCloseTab: (tabId: string) => void,
) {
  const tab = tabs[index];
  if (!tab) return;
  const last = tabs.length - 1;

  if (event.key === 'Delete') {
    event.preventDefault();
    onCloseTab(tab.id);
    return;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onSelectTab(tab.id);
    return;
  }

  let target: number | null = null;
  if (event.key === 'ArrowRight') target = index === last ? 0 : index + 1;
  else if (event.key === 'ArrowLeft') target = index === 0 ? last : index - 1;
  else if (event.key === 'Home') target = 0;
  else if (event.key === 'End') target = last;
  if (target === null) return;

  event.preventDefault();
  const next = tabs[target];
  if (!next) return;
  onSelectTab(next.id);

  // Selecting alone only moves the tabindex; focus would stay on the now
  // untabbable previous tab. DOM order matches `tabs`.
  const sibling = event.currentTarget.parentElement?.children[target];
  if (sibling instanceof HTMLElement) sibling.focus();
}
