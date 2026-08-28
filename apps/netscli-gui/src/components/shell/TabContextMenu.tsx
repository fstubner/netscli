import { X, XCircle, XSquare } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useRovingFocus } from '../primitives/focus';
import { computePointPopoverPosition, useOverlayDismiss } from '../primitives/overlay';

export interface TabContextTarget {
  tabId: string;
  /** Position of the tab in the strip, for deciding what is closable. */
  index: number;
  total: number;
  x: number;
  y: number;
}

interface TabContextMenuProps {
  target: TabContextTarget;
  onClose: () => void;
  onCloseTab: (tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseBeside: (tabId: string, side: 'left' | 'right') => void;
  onCloseAll: () => void;
}

/**
 * Right-click menu for a workspace tab.
 *
 * Every item acts on the tab that was clicked, not the active one — those are
 * often different, and acting on the active tab is the surprising reading of
 * "close others" when you right-clicked something else.
 *
 * Items that would do nothing are disabled rather than hidden, so the menu
 * keeps the same shape wherever you open it: a menu whose contents move as
 * you right-click along the strip is harder to use than one with a greyed
 * row. "Close to the left" is here for symmetry with "to the right" — it is
 * the less-used of the pair, but its absence is conspicuous to anyone who
 * expects the editor convention.
 */
export function TabContextMenu({
  target,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseBeside,
  onCloseAll,
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const position = useMemo(
    () => computePointPopoverPosition(target.x, target.y, 210, 186, window.innerWidth, window.innerHeight),
    [target.x, target.y],
  );
  const onKeyDown = useRovingFocus({
    containerRef: menuRef,
    enabled: true,
    itemSelector: 'button:not(:disabled)',
    onClose,
  });

  useOverlayDismiss({ enabled: true, onClose, refs: [menuRef] });

  const toTheRight = target.total - target.index - 1;
  const toTheLeft = target.index;
  const others = target.total - 1;

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const items = [
    { Icon: X, label: 'Close', disabled: false, action: () => onCloseTab(target.tabId) },
    {
      Icon: XCircle,
      label: 'Close others',
      disabled: others === 0,
      action: () => onCloseOthers(target.tabId),
    },
    {
      Icon: XCircle,
      label: 'Close to the right',
      disabled: toTheRight === 0,
      action: () => onCloseBeside(target.tabId, 'right'),
    },
    {
      Icon: XCircle,
      label: 'Close to the left',
      disabled: toTheLeft === 0,
      action: () => onCloseBeside(target.tabId, 'left'),
    },
    { Icon: XSquare, label: 'Close all', disabled: false, action: onCloseAll, separated: true },
  ];

  return (
    <div
      className="content-context-menu"
      data-testid="tab-context-menu"
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top }}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {items.map(({ Icon, label, disabled, action, separated }) => (
        <button
          className={separated ? 'context-separated' : undefined}
          disabled={disabled}
          key={label}
          role="menuitem"
          type="button"
          onClick={run(action)}
        >
          <Icon size={13} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
