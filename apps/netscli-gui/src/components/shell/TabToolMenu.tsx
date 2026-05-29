import { LOOKUP_TOOL_KINDS, SCAN_TOOL_KINDS, TOOL_CONFIG } from '../../tools/registry';
import type { ToolKind } from '../../tools/types';

interface TabToolMenuProps {
  onAddToolTab: (kind: ToolKind) => void;
  position: { left: number; top: number };
  setOpenMenu: (menu: string | null) => void;
}

export function TabToolMenu({ onAddToolTab, position, setOpenMenu }: TabToolMenuProps) {
  return (
    <div className="tab-tool-popover" style={position}>
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

