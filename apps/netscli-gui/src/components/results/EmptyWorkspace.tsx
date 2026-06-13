import { Search, Terminal, Wrench } from 'lucide-react';
import { useRef, useState } from 'react';

import { availableToolKinds, LOOKUP_TOOL_KINDS, SCAN_TOOL_KINDS, TOOL_CONFIG } from '../../tools/registry';
import type { ToolCapabilityMap, ToolKind } from '../../tools/types';
import { useRovingFocus } from '../primitives/focus';
import { useOverlayDismiss } from '../primitives/overlay';

interface EmptyWorkspaceProps {
  toolCapabilities: ToolCapabilityMap;
  onAddToolTab: (kind: ToolKind) => void;
}

type PickerKind = 'scan' | 'tool';

export function EmptyWorkspace({ onAddToolTab, toolCapabilities }: EmptyWorkspaceProps) {
  const [pickerKind, setPickerKind] = useState<PickerKind | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const pickerPanelRef = useRef<HTMLDivElement | null>(null);
  const pickerOpen = pickerKind !== null;
  const closePicker = () => setPickerKind(null);
  const onPickerKeyDown = useRovingFocus({
    containerRef: pickerPanelRef,
    enabled: pickerOpen,
    itemSelector: 'button:not(:disabled)',
    onClose: closePicker,
  });
  useOverlayDismiss({
    enabled: pickerOpen,
    onClose: closePicker,
    refs: [pickerRef, pickerPanelRef],
  });

  const pickerConfig =
    pickerKind === 'scan'
      ? { kinds: SCAN_TOOL_KINDS, label: 'Scan Operations' }
      : { kinds: availableToolKinds(LOOKUP_TOOL_KINDS, toolCapabilities), label: 'Lookups and Inventory' };

  function togglePicker(kind: PickerKind) {
    setPickerKind((current) => (current === kind ? null : kind));
  }

  return (
    <section className="empty-tabs-state" data-testid="empty-workspace-state" aria-labelledby="empty-workspace-title">
      <Terminal size={30} />
      <h1 id="empty-workspace-title">No Tabs Open</h1>
      <div className="empty-tabs-actions" ref={pickerRef}>
        <button
          aria-expanded={pickerKind === 'scan'}
          aria-haspopup="menu"
          className="primary"
          data-testid="empty-choose-scan"
          type="button"
          onClick={() => togglePicker('scan')}
        >
          <Search size={15} />
          <span>Choose Scan</span>
        </button>
        <div className="empty-tool-picker">
          <button
            aria-expanded={pickerKind === 'tool'}
            aria-haspopup="menu"
            data-testid="empty-choose-tool"
            type="button"
            onClick={() => togglePicker('tool')}
          >
            <Wrench size={15} />
            <span>Choose Tool</span>
          </button>
        </div>
        {pickerOpen && (
          <div
            className="empty-tool-launcher"
            data-testid="empty-tool-popover"
            ref={pickerPanelRef}
            role="menu"
            tabIndex={-1}
            onKeyDown={onPickerKeyDown}
          >
            <ToolPickerSection
              kinds={pickerConfig.kinds}
              label={pickerConfig.label}
              onAddToolTab={onAddToolTab}
              onClose={() => setPickerKind(null)}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function ToolPickerSection({
  kinds,
  label,
  onAddToolTab,
  onClose,
}: {
  kinds: ToolKind[];
  label: string;
  onAddToolTab: (kind: ToolKind) => void;
  onClose: () => void;
}) {
  return (
    <div className="empty-tool-section">
      <span className="empty-tool-section-label">{label}</span>
      {kinds.map((kind) => {
        const config = TOOL_CONFIG[kind];
        const Icon = config.Icon;
        return (
          <button
            key={kind}
            type="button"
            role="menuitem"
            onClick={() => {
              onAddToolTab(kind);
              onClose();
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
