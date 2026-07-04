import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import type { DefaultInterfaceInfo, InterfaceInfo } from '../../types/netscli';
import { clampMaxConcurrentProbes, type MaxConcurrentProbes } from '../../hooks/usePreferences';
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
    <label className="settings-checkbox-row" data-testid={testId}>
      <input
        checked={checked}
        className="settings-checkbox-native"
        type="checkbox"
        onChange={onClick}
      />
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
  compact?: boolean;
  onSelect: (name: string) => void;
}

interface SettingsSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SettingsSelectProps {
  label: string;
  options: SettingsSelectOption[];
  testId: string;
  value: string;
  onSelect: (value: string) => void;
}

interface SettingsNumberInputProps {
  label: string;
  max?: number;
  min?: number;
  step?: number;
  testId: string;
  value: number;
  onChange: (value: MaxConcurrentProbes) => void;
}

export function SettingsNumberInput({
  label,
  max = 1024,
  min = 1,
  step = 16,
  testId,
  value,
  onChange,
}: SettingsNumberInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitValue = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setDraft(String(value));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clampMaxConcurrentProbes(Math.min(max, Math.max(min, parsed)));
    onChange(next);
    setDraft(String(next));
  };

  return (
    <div className="settings-number-field">
      <button
        aria-label={`Decrease ${label}`}
        className="settings-number-stepper"
        disabled={value <= min}
        type="button"
        onClick={() => commitValue(String(value - step))}
      >
        -
      </button>
      <label className="settings-number-input-wrap">
        <input
          aria-label={label}
          data-testid={testId}
          inputMode="numeric"
          max={max}
          min={min}
          step={step}
          type="number"
          value={draft}
          onBlur={(event) => commitValue(event.currentTarget.value)}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitValue(event.currentTarget.value);
            }
          }}
        />
        <span>probes</span>
      </label>
      <button
        aria-label={`Increase ${label}`}
        className="settings-number-stepper"
        disabled={value >= max}
        type="button"
        onClick={() => commitValue(String(value + step))}
      >
        +
      </button>
    </div>
  );
}

export function SettingsSelect({
  label,
  options,
  testId,
  value,
  onSelect,
}: SettingsSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const position = useAnchoredPopoverPosition({
    align: 'end',
    anchorRef: triggerRef,
    estimatedHeight: 180,
    open,
    panelRef: listRef,
    width: 190,
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
    <div className="settings-select-field">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className={`settings-select-trigger ${open ? 'active' : ''}`}
        data-testid={testId}
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
        <span>{selectedOption?.label ?? value}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          aria-label={label}
          className="settings-select-list"
          ref={listRef}
          role="listbox"
          style={position}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
        >
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value ? 'selected' : ''}
              key={option.value}
              role="option"
              type="button"
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
            >
              <span className="settings-select-option-label">{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
