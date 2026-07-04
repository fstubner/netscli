import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useRovingFocus } from '../primitives/focus';
import { useAnchoredPopoverPosition, useOverlayDismiss } from '../primitives/overlay';
import { TOOL_CONFIG } from '../../tools/registry';
import type { ToolField, WorkspaceTab } from '../../tools/types';
import type { InterfaceInfo } from '../../types/netscli';

interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface ToolFormProps {
  tab: WorkspaceTab;
  interfaces?: InterfaceInfo[];
  onPatchForm: (tabId: string, key: string, value: string) => void;
  onRun: (tabId: string) => void;
}

export function ToolForm({ tab, interfaces = [], onPatchForm, onRun }: ToolFormProps) {
  const config = TOOL_CONFIG[tab.kind];
  const [openField, setOpenField] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverPosition = useAnchoredPopoverPosition({
    align: 'end',
    anchorRef: triggerRef,
    estimatedHeight: 220,
    open: openField !== null,
    panelRef: popoverRef,
    width: openField === 'interface' ? 330 : 160,
  });
  const onSelectKeyDown = useRovingFocus({
    containerRef: popoverRef,
    enabled: openField !== null,
    itemSelector: 'button[role="option"]',
    onClose: () => setOpenField(null),
  });

  useOverlayDismiss({
    enabled: openField !== null,
    onClose: () => setOpenField(null),
    refs: [formRef],
    restoreFocusRef: triggerRef,
  });

  useEffect(() => setOpenField(null), [tab.id]);

  const inputsDisabled = tab.busy;

  return (
    <div className={`form-row${inputsDisabled ? ' form-row-busy' : ''}`} ref={formRef}>
      {fieldsForTab(tab, config.fields).map((field) => {
        const options = selectOptionsForField(tab, field.key, field.options, interfaces);
        const selectedValue = tab.form[field.key] || field.placeholder || options[0]?.value || '';
        const selectedLabel = options.find((option) => option.value === tab.form[field.key])?.label ?? selectedValue;

        return (
          <div className={`form-field ${field.compact ? 'compact' : ''}`} key={field.key}>
            <span>{field.label}</span>
            {field.type === 'number' ? (
              <NumberField
                disabled={inputsDisabled}
                field={field}
                tab={tab}
                onPatchForm={onPatchForm}
                onRun={onRun}
              />
            ) : field.type === 'select' ? (
              <div className="field-select">
              <button
                aria-expanded={openField === field.key}
                aria-haspopup="listbox"
                aria-label={field.label}
                className={`field-select-trigger ${openField === field.key ? 'active' : ''}`}
                data-testid={`${tab.kind}-${field.key}-input`}
                disabled={inputsDisabled}
                ref={openField === field.key ? triggerRef : undefined}
                type="button"
                onClick={() => {
                  if (inputsDisabled) return;
                  setOpenField(openField === field.key ? null : field.key);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setOpenField(null);
                  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setOpenField(field.key);
                  }
                }}
              >
                <span>{selectedLabel}</span>
                <ChevronDown size={13} />
              </button>
              {openField === field.key && (
                <div
                  className="field-select-popover"
                  data-testid={`${tab.kind}-${field.key}-popover`}
                  ref={popoverRef}
                  role="listbox"
                  style={{
                    left: popoverPosition.left,
                    maxHeight: popoverPosition.maxHeight,
                    minWidth: triggerRef.current?.getBoundingClientRect().width,
                    top: popoverPosition.top,
                    width: field.key === 'interface' ? 'min(360px, calc(100vw - 24px))' : undefined,
                  }}
                  tabIndex={-1}
                  onKeyDown={onSelectKeyDown}
                >
                  {options.map((option) => (
                    <button
                      className={option.value === tab.form[field.key] ? 'selected' : ''}
                      key={option.value}
                      role="option"
                      aria-selected={option.value === tab.form[field.key]}
                      type="button"
                      onClick={() => {
                        onPatchForm(tab.id, field.key, option.value);
                        setOpenField(null);
                      }}
                    >
                      <span className="field-select-option-label">{option.label}</span>
                      {option.description ? (
                        <span className="field-select-option-meta">{option.description}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
              </div>
          ) : (
            <input
              aria-label={field.label}
              autoCapitalize="off"
              autoCorrect="off"
              data-testid={`${tab.kind}-${field.key}-input`}
              disabled={inputsDisabled}
              spellCheck={false}
              type={field.type ?? 'text'}
              value={tab.form[field.key] ?? ''}
              placeholder={field.placeholder}
              onChange={(event) => onPatchForm(tab.id, field.key, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRun(tab.id);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function NumberField({
  disabled,
  field,
  tab,
  onPatchForm,
  onRun,
}: {
  disabled: boolean;
  field: ToolField;
  tab: WorkspaceTab;
  onPatchForm: (tabId: string, key: string, value: string) => void;
  onRun: (tabId: string) => void;
}) {
  const value = tab.form[field.key] ?? '';
  const numericValue = numberFromFieldValue(value, field);
  const min = field.min;
  const max = field.max;
  const step = field.step ?? 1;

  function commit(raw: string) {
    onPatchForm(tab.id, field.key, normalizeNumberFieldValue(raw, field));
  }

  function stepBy(delta: number) {
    const next = clampNumber((numericValue ?? numberFromFieldValue(field.placeholder, field) ?? min ?? 0) + delta * step, field);
    onPatchForm(tab.id, field.key, formatNumberFieldValue(next, field));
  }

  return (
    <div className="number-field-control">
      <input
        aria-label={field.label}
        autoCapitalize="off"
        autoCorrect="off"
        data-testid={`${tab.kind}-${field.key}-input`}
        disabled={disabled}
        inputMode="numeric"
        max={max}
        min={min}
        spellCheck={false}
        step={step}
        type="number"
        value={value}
        placeholder={field.placeholder}
        onBlur={(event) => commit(event.currentTarget.value)}
        onChange={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit(event.currentTarget.value);
            window.setTimeout(() => onRun(tab.id), 0);
          }
        }}
      />
      <span className="number-field-steppers">
        <button
          aria-label={`Increase ${field.label}`}
          data-tooltip={`Increase ${field.label}`}
          disabled={disabled || (max !== undefined && numericValue !== null && numericValue >= max)}
          tabIndex={-1}
          type="button"
          onClick={() => stepBy(1)}
        >
          <ChevronUp size={10} />
        </button>
        <button
          aria-label={`Decrease ${field.label}`}
          data-tooltip={`Decrease ${field.label}`}
          disabled={disabled || (min !== undefined && numericValue !== null && numericValue <= min)}
          tabIndex={-1}
          type="button"
          onClick={() => stepBy(-1)}
        >
          <ChevronDown size={10} />
        </button>
      </span>
    </div>
  );
}

function normalizeNumberFieldValue(raw: string, field: ToolField): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return '';
  return formatNumberFieldValue(clampNumber(parsed, field), field);
}

function numberFromFieldValue(value: string | undefined, field: ToolField): number | null {
  const normalized = normalizeNumberFieldValue(value ?? '', field);
  return normalized ? Number(normalized) : null;
}

function clampNumber(value: number, field: ToolField): number {
  const step = field.step ?? 1;
  const stepped = Number.isInteger(step) ? Math.trunc(value) : value;
  const lowerBounded = field.min === undefined ? stepped : Math.max(field.min, stepped);
  return field.max === undefined ? lowerBounded : Math.min(field.max, lowerBounded);
}

function formatNumberFieldValue(value: number, field: ToolField): string {
  return Number.isInteger(field.step ?? 1) ? String(Math.trunc(value)) : String(value);
}

function fieldsForTab(tab: WorkspaceTab, fields: ToolField[]): ToolField[] {
  if (tab.kind !== 'pcap') return fields;
  const mode = tab.form.mode || 'Capture';
  if (mode === 'Open File') {
    return fields.filter((field) => field.key === 'mode' || field.key === 'max_packets');
  }
  return fields;
}

function selectOptionsForField(
  tab: WorkspaceTab,
  fieldKey: string,
  staticOptions: string[] | undefined,
  interfaces: InterfaceInfo[],
): SelectOption[] {
  if (tab.kind === 'pcap' && fieldKey === 'interface') {
    return pcapInterfaceOptions(interfaces, tab.form[fieldKey]);
  }

  return (staticOptions ?? []).map((option) => ({ value: option, label: option }));
}

function pcapInterfaceOptions(interfaces: InterfaceInfo[], currentValue: string | undefined): SelectOption[] {
  const sorted = [...interfaces].sort((a, b) => interfaceScore(b) - interfaceScore(a));
  const options = sorted.map((iface) => ({
    value: iface.name,
    label: iface.name,
    description: interfaceDescription(iface),
  }));

  if (currentValue && !options.some((option) => option.value === currentValue)) {
    options.unshift({
      value: currentValue,
      label: currentValue,
      description: 'Custom interface',
    });
  }

  return options;
}

function interfaceScore(iface: InterfaceInfo): number {
  const upScore = iface.is_up ? 100 : 0;
  const physicalScore = iface.is_loopback || isVirtualInterfaceName(iface.name) ? 0 : 50;
  const addressScore = iface.ips.length > 0 ? 10 : 0;
  return upScore + physicalScore + addressScore;
}

function interfaceDescription(iface: InterfaceInfo): string {
  const address = preferredInterfaceAddress(iface.ips);
  const state = iface.is_up ? 'Up' : 'Down';
  const loopback = iface.is_loopback ? ' - Loopback' : '';
  return address ? `${address} - ${state}${loopback}` : `${state}${loopback}`;
}

function preferredInterfaceAddress(ips: string[]): string | null {
  return (
    ips.find((ip) => !ip.startsWith('169.254.') && !ip.startsWith('fe80:')) ??
    ips[0] ??
    null
  );
}

function isVirtualInterfaceName(name: string): boolean {
  return /tailscale|loopback|bluetooth|vethernet|default switch|wsl|docker|hyper-v|vmware|virtualbox|vmnet|npcap|pseudo-interface/i.test(
    name,
  );
}
