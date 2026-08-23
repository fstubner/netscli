import type { MouseEvent } from 'react';

import { appWindowAction } from '../../services/appWindow';

/**
 * Start a window drag from the custom title bar, unless the press landed on
 * something interactive.
 *
 * Without the guard the whole frame is a drag handle, so pressing a menu or a
 * button moves the window instead of activating the control.
 */
export function handleAppFrameMouseDown(event: MouseEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (target.closest('button,input,select,a,[role="button"],.menu-popover')) return;
  void appWindowAction('drag');
}
