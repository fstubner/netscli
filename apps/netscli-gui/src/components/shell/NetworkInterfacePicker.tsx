import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import type { DefaultInterfaceInfo, InterfaceInfo } from '../../types/netscli';
import { useRovingFocus } from '../primitives/focus';
import { useOverlayDismiss } from '../primitives/overlay';

interface NetworkInterfacePickerProps {
  defaultInterface: DefaultInterfaceInfo | null;
  interfaces: InterfaceInfo[];
  selectedName: string | null;
  compact?: boolean;
  onSelect: (name: string) => void;
}

export function NetworkInterfacePicker({
  defaultInterface,
  interfaces,
  selectedName,
  compact = false,
  onSelect,
}: NetworkInterfacePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedInterface = interfaces.find((iface) => iface.name === selectedName);
  const selectedInterfaceName = selectedInterface?.name ?? selectedName ?? '';
  const selectedInterfaceDetail = selectedInterface
    ? compact ? formatSelectedInterfaceMeta(selectedInterface, selectedInterface.name === defaultInterface?.name) : formatInterfaceDetail(selectedInterface)
    : 'Detecting...';

  useOverlayDismiss({
    enabled: open,
    onClose: () => setOpen(false),
    refs: [triggerRef, listRef],
    restoreFocusRef: triggerRef,
  });

  const onListKeyDown = useRovingFocus({
    containerRef: listRef,
    enabled: open,
    itemSelector: 'button[role="option"]',
    onClose: () => setOpen(false),
  });

  return (
    <div className={`settings-interface-field ${compact ? 'compact' : ''}`}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`settings-interface-trigger ${open ? 'active' : ''}`}
        data-interface-name={selectedInterfaceName}
        data-interface-up={selectedInterface?.is_up ? 'true' : 'false'}
        data-testid="settings-interface-trigger"
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      >
        <span>
          <span>{compact ? selectedInterfaceName || 'Detecting...' : 'Network Interface'}</span>
          <small>
            {selectedInterfaceName
              ? compact ? selectedInterfaceDetail : `${selectedInterfaceName} - ${selectedInterfaceDetail}`
              : 'Detecting...'}
          </small>
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          aria-label="Network Interface"
          className="settings-interface-list"
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
        >
          {interfaces.length === 0 && <span className="settings-empty">Detecting...</span>}
          {interfaces.map((iface) => {
            const selected = iface.name === selectedInterfaceName;
            const isDefault = iface.name === defaultInterface?.name;

            return (
              <button
                aria-selected={selected}
                className={`settings-interface-option ${selected ? 'selected' : ''}`}
                data-interface-name={iface.name}
                data-interface-up={iface.is_up ? 'true' : 'false'}
                data-testid="settings-interface-option"
                key={iface.name}
                role="option"
                type="button"
                onClick={() => {
                  onSelect(iface.name);
                  setOpen(false);
                }}
              >
                <span className="settings-interface-main">
                  <span className="settings-interface-title-row">
                    <span className="settings-interface-name">{iface.name}</span>
                    <span className="settings-interface-badges">
                      {isDefault && <span className="settings-interface-badge">Primary</span>}
                      {selected && (
                        <span className="settings-interface-badge selected">
                          <Check size={11} />
                          Selected
                        </span>
                      )}
                      <span className={`settings-interface-status ${iface.is_up ? 'up' : 'down'}`}>
                        <span aria-hidden="true" />
                        {iface.is_up ? 'Up' : 'Down'}
                      </span>
                    </span>
                  </span>
                  <small>{compact ? formatInterfaceAddressSummary(iface) : formatInterfaceDetail(iface)}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatInterfaceDetail(iface: InterfaceInfo): string {
  const status = iface.is_up ? 'Up' : 'Down';
  const addresses = formatInterfaceAddressSummary(iface);
  return `${addresses} - ${status}`;
}

function formatInterfaceAddressSummary(iface: InterfaceInfo): string {
  return iface.ips.length > 0 ? iface.ips.slice(0, 2).join(', ') : 'No address';
}

function formatSelectedInterfaceMeta(iface: InterfaceInfo, isDefault: boolean): string {
  return [
    'Selected',
    isDefault ? 'Primary' : '',
    iface.is_up ? 'Up' : 'Down',
  ].filter(Boolean).join(' - ');
}
