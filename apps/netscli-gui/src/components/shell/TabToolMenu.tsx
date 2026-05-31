import { useRef, type RefObject } from 'react';

import { LOOKUP_TOOL_KINDS, SCAN_TOOL_KINDS, TOOL_CONFIG } from '../../tools/registry';
import type { ToolKind } from '../../tools/types';
import { useRovingFocus } from '../primitives/focus';
import { useOverlayDismiss, type PopoverPosition } from '../primitives/overlay';

interface TabToolMenuProps {
  onAddToolTab: (kind: ToolKind) => void;
  position: PopoverPosition;
  setOpenMenu: (menu: string | null) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function TabToolMenu({ onAddToolTab, position, setOpenMenu, triggerRef }: TabToolMenuProps) {
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
        onAddToolTab={onAddToolTab}
        setOpenMenu={setOpenMenu}
      />
      <ToolMenuSection
        kinds={LOOKUP_TOOL_KINDS}
        label="Lookups and inventory"
        onAddToolTab={onAddToolTab}
        setOpenMenu={setOpenMenu}
      />
    </div>
  );
}

function ToolMenuSection({
  kinds,
  label,
  onAddToolTab,
  setOpenMenu,
}: {
  kinds: ToolKind[];
  label: string;
  onAddToolTab: (kind: ToolKind) => void;
  setOpenMenu: (menu: string | null) => void;
}) {
  return (
    <div className="tab-tool-section">
      <span className="tab-tool-section-label">{label}</span>
      {kinds.map((kind) => {
        const config = TOOL_CONFIG[kind];
        const Icon = config.Icon;
        return (
          <button
            key={kind}
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
