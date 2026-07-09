import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

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

