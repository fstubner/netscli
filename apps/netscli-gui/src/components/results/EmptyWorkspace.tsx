import { Search, Terminal, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { LOOKUP_TOOL_KINDS, SCAN_TOOL_KINDS, TOOL_CONFIG } from '../../tools/registry';
import type { ToolKind } from '../../tools/types';

interface EmptyWorkspaceProps {
  onAddToolTab: (kind: ToolKind) => void;
}

type PickerKind = 'scan' | 'tool';

export function EmptyWorkspace({ onAddToolTab }: EmptyWorkspaceProps) {
  const [pickerKind, setPickerKind] = useState<PickerKind | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const pickerOpen = pickerKind !== null;

  useEffect(() => {
    if (!pickerOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerKind(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setPickerKind(null);
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [pickerOpen]);

  const pickerConfig =
    pickerKind === 'scan'
      ? { kinds: SCAN_TOOL_KINDS, label: 'Scan Operations' }
      : { kinds: LOOKUP_TOOL_KINDS, label: 'Lookups and Inventory' };

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
            data-testid="empty-choose-tool"
            type="button"
            onClick={() => togglePicker('tool')}
          >
            <Wrench size={15} />
            <span>Choose Tool</span>
          </button>
        </div>
        {pickerOpen && (
          <div className="empty-tool-launcher" data-testid="empty-tool-popover">
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
