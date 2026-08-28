import type { SelectOption } from './toolFormFields';

interface FieldSelectOptionsProps {
  options: SelectOption[];
  selected: string | undefined;
  onSelect: (value: string) => void;
}

/**
 * The listbox rows inside a form field's select popover.
 *
 * Split out of ToolForm purely for depth: an options `.map` holding a button
 * holding a click handler sat eight braces deep inside the field `.map`
 * inside the component, which is the point where the shape of the markup
 * stops being readable. Nothing about the behaviour changed, and the state
 * stays in ToolForm -- this takes the three things a row actually needs.
 */
export function FieldSelectOptions({ options, selected, onSelect }: FieldSelectOptionsProps) {
  return (
    <>
      {options.map((option) => (
        <button
          className={option.value === selected ? 'selected' : ''}
          key={option.value}
          role="option"
          aria-selected={option.value === selected}
          type="button"
          onClick={() => onSelect(option.value)}
        >
          <span className="field-select-option-label">{option.label}</span>
          {option.description ? (
            <span className="field-select-option-meta">{option.description}</span>
          ) : null}
        </button>
      ))}
    </>
  );
}
