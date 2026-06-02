import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useRovingFocus } from '../primitives/focus';
import { useAnchoredPopoverPosition, useOverlayDismiss } from '../primitives/overlay';
import { TOOL_CONFIG } from '../../tools/registry';
import type { WorkspaceTab } from '../../tools/types';
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

  return (
    <div className="form-row" ref={formRef}>
      {config.fields.map((field) => {
        const options = selectOptionsForField(tab, field.key, field.options, interfaces);
        const selectedValue = tab.form[field.key] || field.placeholder || options[0]?.value || '';
        const selectedLabel = options.find((option) => option.value === tab.form[field.key])?.label ?? selectedValue;

        return (
          <div className={`form-field ${field.compact ? 'compact' : ''}`} key={field.key}>
            <span>{field.label}</span>
            {field.type === 'select' ? (
            <div className="field-select">
              <button
                aria-expanded={openField === field.key}
                aria-haspopup="listbox"
                aria-label={field.label}
                className={`field-select-trigger ${openField === field.key ? 'active' : ''}`}
                data-testid={`${tab.kind}-${field.key}-input`}
                ref={openField === field.key ? triggerRef : undefined}
                type="button"
                onClick={() => setOpenField(openField === field.key ? null : field.key)}
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
