import { useRef, type RefObject } from 'react';

import { availableToolKinds, LOOKUP_TOOL_KINDS, SCAN_TOOL_KINDS, TOOL_CONFIG } from '../../tools/registry';
import type { ToolCapabilityMap, ToolKind } from '../../tools/types';
import { useRovingFocus } from '../primitives/focus';
import { useOverlayDismiss, type PopoverPosition } from '../primitives/overlay';

interface TabToolMenuProps {
  onAddToolTab: (kind: ToolKind) => void;
  position: PopoverPosition;
  setOpenMenu: (menu: string | null) => void;
  toolCapabilities: ToolCapabilityMap;
  /** Why a tool cannot run, per kind. Greys the entry and explains it, the
   *  same way the menu bar does -- see menuItems.ts for why these are greyed
   *  rather than removed. Without it this menu offered packet capture as an
   *  ordinary item on a build that cannot do it, while the menu bar three
   *  inches away greyed the very same entry. */
  toolDisabledReasons?: Partial<Record<ToolKind, string>>;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function TabToolMenu({
  onAddToolTab,
  position,
  setOpenMenu,
  toolCapabilities,
  toolDisabledReasons,
  triggerRef,
}: TabToolMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = () => setOpenMenu(null);
  const onKeyDown = useRovingFocus({
    containerRef: menuRef,
    enabled: true,
    itemSelector: 'button:not(:disabled)',
    onClose: closeMenu,
  });
  useOverlayDismiss({
    enabled: true,
    onClose: closeMenu,
    refs: [triggerRef, menuRef],
    restoreFocusRef: triggerRef,
  });

  return (
    <div
      className="tab-tool-popover"
      ref={menuRef}
      role="menu"
      style={position}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <ToolMenuSection
        kinds={SCAN_TOOL_KINDS}
        label="Scan operations"
        reasons={toolDisabledReasons}
        onAddToolTab={onAddToolTab}
        setOpenMenu={setOpenMenu}
      />
      <ToolMenuSection
        kinds={availableToolKinds(LOOKUP_TOOL_KINDS, toolCapabilities)}
        label="Lookups and inventory"
        reasons={toolDisabledReasons}
        onAddToolTab={onAddToolTab}
        setOpenMenu={setOpenMenu}
      />
    </div>
  );
}

function ToolMenuSection({
  kinds,
  label,
  reasons,
  onAddToolTab,
  setOpenMenu,
}: {
  kinds: ToolKind[];
  label: string;
  reasons?: Partial<Record<ToolKind, string>>;
  onAddToolTab: (kind: ToolKind) => void;
  setOpenMenu: (menu: string | null) => void;
}) {
  return (
    <div className="tab-tool-section">
      <span className="tab-tool-section-label">{label}</span>
      {kinds.map((kind) => {
        const config = TOOL_CONFIG[kind];
        const Icon = config.Icon;
        const reason = reasons?.[kind];
        return (
          <button
            key={kind}
            className={reason ? 'muted' : undefined}
            data-tooltip={reason ? `${reason} Open for setup instructions.` : undefined}
            role="menuitem"
            onClick={() => {
              onAddToolTab(kind);
              setOpenMenu(null);
            }}
          >
            <Icon size={14} />
            <span>{config.label}</span>
          </button>
        );
      })}
    </div>
  );
}
