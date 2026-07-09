import { ChevronDown, ChevronUp } from 'lucide-react';

import type { ToolField, WorkspaceTab } from '../../tools/types';

interface NumberFieldProps {
  disabled: boolean;
  field: ToolField;
  tab: WorkspaceTab;
  onPatchForm: (tabId: string, key: string, value: string) => void;
  onRun: (tabId: string) => void;
}

export function NumberField({ disabled, field, tab, onPatchForm, onRun }: NumberFieldProps) {
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
