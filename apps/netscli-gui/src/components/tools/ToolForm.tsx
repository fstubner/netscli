import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useRovingFocus } from '../primitives/focus';
import { useAnchoredPopoverPosition, useOverlayDismiss } from '../primitives/overlay';
import { TOOL_CONFIG } from '../../tools/registry';
import type { WorkspaceTab } from '../../tools/types';
import type { InterfaceInfo } from '../../types/netscli';
import { FieldSelectOptions } from './FieldSelectOptions';
import { NumberField } from './NumberField';
import { fieldsForTab, selectOptionsForField } from './toolFormFields';

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
                  <FieldSelectOptions
                    options={options}
                    selected={tab.form[field.key]}
                    onSelect={(value) => {
                      onPatchForm(tab.id, field.key, value);
                      setOpenField(null);
                    }}
                  />
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

