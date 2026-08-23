import { ChevronDown, Play } from 'lucide-react';
import { useRef } from 'react';

import { ARP_CLEAR_TOOL_KINDS } from '../../tools/registry';
import type { WorkspaceTab } from '../../tools/types';
import { useRovingFocus } from '../primitives/focus';
import { useAnchoredPopoverPosition, useOverlayDismiss } from '../primitives/overlay';

interface RunSplitButtonProps {
  activeTab: WorkspaceTab | undefined;
  openMenu: string | null;
  runLabel: string;
  runDisabledReason?: string;
  setOpenMenu: (menu: string | null) => void;
  onRunActive: () => void;
  onRunActiveWithArpClear: () => void;
}

/**
 * The run control, plus a chevron on the tools where clearing the OS
 * neighbour cache first changes the answer.
 *
 * The chevron is deliberately absent elsewhere rather than present and
 * disabled: on a port scan there is nothing behind it, and a dead affordance
 * on every tool teaches people to ignore it on the three where it matters.
 */
export function RunSplitButton({
  activeTab,
  openMenu,
  runLabel,
  runDisabledReason,
  setOpenMenu,
  onRunActive,
  onRunActiveWithArpClear,
}: RunSplitButtonProps) {
  const menuOpen = openMenu === 'run-options';
  const disabled = !activeTab || activeTab.busy || Boolean(runDisabledReason);
  const supportsArpClear = Boolean(activeTab) && ARP_CLEAR_TOOL_KINDS.includes(activeTab!.kind);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const position = useAnchoredPopoverPosition({
    align: 'start',
    anchorRef: buttonRef,
    estimatedHeight: 96,
    open: menuOpen,
    panelRef,
    width: 300,
  });
  const closeMenu = () => setOpenMenu(null);
  const onMenuKeyDown = useRovingFocus({
    containerRef: panelRef,
    enabled: menuOpen,
    itemSelector: '.run-options-popover button:not(:disabled)',
    onClose: closeMenu,
  });
  useOverlayDismiss({
    enabled: menuOpen,
    onClose: closeMenu,
    refs: [buttonRef, panelRef],
    restoreFocusRef: buttonRef,
  });

  return (
    <>
      <button
        className="icon-button strong toolbar-run"
        data-testid="run-active-tab"
        disabled={disabled}
        aria-label={runLabel}
        data-tooltip={runDisabledReason ?? runLabel}
        data-tooltip-placement="bottom"
        onClick={onRunActive}
      >
        <Play size={16} />
        <span>{runLabel}</span>
      </button>
      {supportsArpClear && (
        <div className="toolbar-run-options" data-popover="run-options">
          <button
            className="icon-button strong toolbar-run-chevron"
            data-testid="run-options-button"
            ref={buttonRef}
            disabled={disabled}
            aria-label={`${runLabel} options`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            data-tooltip={`${runLabel} options`}
            data-tooltip-placement="bottom"
            onClick={() => setOpenMenu(menuOpen ? null : 'run-options')}
          >
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div
              className="run-options-popover"
              data-popover="run-options"
              data-testid="run-options-menu"
              ref={panelRef}
              role="menu"
              style={{ left: position.left, top: position.top }}
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
            >
              <button
                className="run-options-item"
                data-testid="run-with-arp-clear"
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpenMenu(null);
                  onRunActiveWithArpClear();
                }}
              >
                <span>Clear ARP table, then {runLabel.toLowerCase()}</span>
                <small>
                  Drops cached neighbours so only what answers now is reported.
                  Needs administrator rights.
                </small>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
