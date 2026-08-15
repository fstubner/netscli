// @vitest-environment jsdom
//
// M-3: the field clamped on every keystroke, so in a field with `min: 10`
// typing the "5" of "50" was rewritten to "10" before the "0" arrived — the
// value simply could not be typed. Clearing the field was impossible too,
// because '' normalised straight back to a number.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NumberField } from './NumberField';
import type { ToolField, WorkspaceTab } from '../../tools/types';

const field = {
  key: 'count',
  label: 'Count',
  type: 'number',
  min: 10,
  max: 50,
  step: 1,
  placeholder: '4',
} as unknown as ToolField;

function setup(value = '') {
  const onPatchForm = vi.fn();
  const tab = { id: 'tab-1', kind: 'ping', form: { count: value } } as unknown as WorkspaceTab;
  render(
    <NumberField disabled={false} field={field} tab={tab} onPatchForm={onPatchForm} onRun={vi.fn()} />,
  );
  return { input: screen.getByLabelText('Count'), onPatchForm };
}

describe('NumberField editing', () => {
  it('stores keystrokes verbatim instead of clamping them', () => {
    const { input, onPatchForm } = setup();
    // "5" is below min:10. It must survive, or "50" is untypeable.
    fireEvent.change(input, { target: { value: '5' } });
    expect(onPatchForm).toHaveBeenCalledWith('tab-1', 'count', '5');
  });

  it('lets the field be cleared', () => {
    const { input, onPatchForm } = setup('20');
    fireEvent.change(input, { target: { value: '' } });
    expect(onPatchForm).toHaveBeenCalledWith('tab-1', 'count', '');
  });

  it('clamps on blur, not before', () => {
    const { input, onPatchForm } = setup();
    fireEvent.change(input, { target: { value: '99' } });
    expect(onPatchForm).toHaveBeenLastCalledWith('tab-1', 'count', '99');

    fireEvent.blur(input, { target: { value: '99' } });
    expect(onPatchForm).toHaveBeenLastCalledWith('tab-1', 'count', '50');
  });

  it('clamps a below-minimum value up on blur', () => {
    const { input, onPatchForm } = setup();
    fireEvent.blur(input, { target: { value: '5' } });
    expect(onPatchForm).toHaveBeenLastCalledWith('tab-1', 'count', '10');
  });

  // Rendered with the out-of-range value already in the form, because the
  // input is controlled: `fireEvent.change` alone does not update its DOM
  // value without a re-render, and Enter reads `currentTarget.value`.
  it('clamps on Enter as well as blur', () => {
    const { input, onPatchForm } = setup('99');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPatchForm).toHaveBeenLastCalledWith('tab-1', 'count', '50');
  });

  it('leaves a blurred empty field empty rather than inventing a number', () => {
    const { input, onPatchForm } = setup('20');
    fireEvent.blur(input, { target: { value: '' } });
    expect(onPatchForm).toHaveBeenLastCalledWith('tab-1', 'count', '');
  });
});
