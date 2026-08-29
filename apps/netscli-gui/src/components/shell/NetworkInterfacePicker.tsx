import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import type { AddressPreference } from '../../hooks/usePreferences';
import type { DefaultInterfaceInfo, InterfaceInfo } from '../../types/netscli';
import { useRovingFocus } from '../primitives/focus';
import { useOverlayDismiss } from '../primitives/overlay';
import { preferredStatusAddress } from './address';

interface NetworkInterfacePickerProps {
  addressPreference: AddressPreference;
  defaultInterface: DefaultInterfaceInfo | null;
  interfaces: InterfaceInfo[];
  selectedName: string | null;
  compact?: boolean;
  onSelect: (name: string) => void;
}

export function NetworkInterfacePicker({
  addressPreference,
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
  // The trigger is the selection, so saying "Selected" on it was telling the
  // user the thing they are looking at is the thing they are looking at. The
  // address is the fact they cannot get anywhere else at a glance.
  const selectedInterfaceDetail = selectedInterface
    ? formatInterfaceDetail(selectedInterface, addressPreference)
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
          <small className="mono" title={selectedInterfaceDetail}>
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
                      {/*
                        No "Selected" badge: the row highlight and aria-selected
                        already say it, and a third mint element on the one row
                        that is already mint reads as noise. "Down" is the only
                        status worth spelling out -- an interface that is up is
                        the unremarkable case, and labelling every row "Up"
                        spends width on a word that never varies usefully.
                      */}
                      <span
                        aria-label={iface.is_up ? 'Up' : 'Down'}
                        className={`settings-interface-status ${iface.is_up ? 'up' : 'down'}`}
                        role="img"
                      >
                        <span aria-hidden="true" />
                        {!iface.is_up && <span aria-hidden="true">Down</span>}
                      </span>
                    </span>
                  </span>
                  <small className="mono" title={formatInterfaceAddress(iface, addressPreference)}>
                    {formatInterfaceAddress(iface, addressPreference)}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatInterfaceDetail(iface: InterfaceInfo, preference: AddressPreference): string {
  const address = formatInterfaceAddress(iface, preference);
  // The trigger has no status dot of its own, so a down interface has to say
  // so in words or the selection looks healthy when it is not.
  return iface.is_up ? address : `${address} - Down`;
}

function formatInterfaceAddress(iface: InterfaceInfo, preference: AddressPreference): string {
  return preferredStatusAddress(iface.ips, preference) ?? 'No address';
}
