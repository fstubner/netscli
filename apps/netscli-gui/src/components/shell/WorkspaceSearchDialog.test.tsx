// @vitest-environment jsdom
//
// Focus stays in the search box while the arrow keys move through the results,
// so what a screen reader hears about the current result comes from
// `aria-activedescendant` alone.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTab } from '../../tools/registry';
import { WorkspaceSearchDialog } from './WorkspaceSearchDialog';

beforeEach(() => {
  // jsdom does not implement scrolling, which the dialog does to keep the
  // current result in view.
  Element.prototype.scrollIntoView = vi.fn();
});

function renderSearch() {
  const tabs = [createTab('scan'), createTab('ping'), createTab('dns')];
  render(
    <WorkspaceSearchDialog
      history={[]}
      tabs={tabs}
      onClose={vi.fn()}
      onOpenHistoryEntry={vi.fn()}
      onSelectRow={vi.fn()}
      onSelectTab={vi.fn()}
    />,
  );
  return screen.getByTestId('workspace-search-input');
}

function currentOptionId(input: HTMLElement) {
  const id = input.getAttribute('aria-activedescendant');
  expect(id, 'the search box names no current result').toBeTruthy();
  const option = document.getElementById(id ?? '');
  expect(option, `no element has the id ${id}`).not.toBeNull();
  expect(option?.getAttribute('aria-selected')).toBe('true');
  return id;
}

describe('workspace search', () => {
  it('points the search box at the current result', () => {
    const input = renderSearch();
    const first = currentOptionId(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = currentOptionId(input);
    expect(second).not.toBe(first);
  });

  it('is a combobox that controls the result list', () => {
    const input = renderSearch();
    expect(input.getAttribute('role')).toBe('combobox');
    const listbox = document.getElementById(input.getAttribute('aria-controls') ?? '');
    expect(listbox?.getAttribute('role')).toBe('listbox');
  });
});
