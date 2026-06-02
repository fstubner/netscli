import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import type { DefaultInterfaceInfo, InterfaceInfo } from '../../types/netscli';
import { useRovingFocus } from '../primitives/focus';
import { useAnchoredPopoverPosition, useOverlayDismiss } from '../primitives/overlay';

interface SettingsSwitchProps {
  checked: boolean;
  label: string;
  note: string;
  testId: string;
  onClick: () => void;
}

export function SettingsSwitch({
  checked,
  label,
  note,
  testId,
  onClick,
}: SettingsSwitchProps) {
  return (
    <label
      className="settings-checkbox-row"
      data-testid={testId}
    >
      <input checked={checked} type="checkbox" onChange={onClick} />
      <span className="settings-row-copy">
        <span>{label}</span>
        <small>{note}</small>
      </span>
      <span className="settings-checkbox-box" aria-hidden="true">
        {checked && <Check size={12} />}
      </span>
    </label>
  );
}

interface NetworkInterfacePickerProps {
  defaultInterface: DefaultInterfaceInfo | null;
  interfaces: InterfaceInfo[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}

export function NetworkInterfacePicker({
  defaultInterface,
  interfaces,
  selectedName,
  onSelect,
}: NetworkInterfacePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedInterface = interfaces.find((iface) => iface.name === selectedName);
  const selectedInterfaceName = selectedInterface?.name ?? selectedName ?? '';
  const selectedInterfaceDetail = selectedInterface
    ? formatInterfaceDetail(selectedInterface)
    : 'Detecting...';
  const position = useAnchoredPopoverPosition({
    anchorRef: triggerRef,
    estimatedHeight: 280,
    open,
    panelRef: listRef,
    width: 620,
  });

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
    <div className="settings-interface-field">
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
          }
        }}
      >
        <span>
          <span>Network Interface</span>
          <small>
            {selectedInterfaceName
              ? `${selectedInterfaceName} - ${selectedInterfaceDetail}`
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
          style={position}
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
                  <span>{iface.name}</span>
                  <small>{formatInterfaceDetail(iface)}</small>
                </span>
                <span className="settings-interface-badges">
                  {isDefault && <span className="settings-interface-badge">Default</span>}
                  {selected && (
                    <span className="settings-interface-badge selected">
                      <Check size={11} />
                      Selected
                    </span>
                  )}
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
  const addresses = iface.ips.length > 0 ? iface.ips.slice(0, 2).join(', ') : 'No address';
  return `${addresses} - ${status}`;
}
