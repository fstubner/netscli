// @vitest-environment jsdom
//
// The filter hints are built from every row of the result. They only change
// when the result does, but the toolbar re-renders with the whole app, so
// building them in the render body redid that work for each keystroke in the
// filter box, each selection change and each status poll.

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createTab } from '../../tools/registry';
import type { WorkspaceTab } from '../../tools/types';

vi.mock('../../tools/presentation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tools/presentation')>();
  return { ...actual, filterHintsFor: vi.fn(actual.filterHintsFor) };
});

const { filterHintsFor } = await import('../../tools/presentation');
const { Toolbar } = await import('./Toolbar');

function toolbar(tab: WorkspaceTab, filterText: string) {
  return (
    <Toolbar
      activeTab={tab}
      filterText={filterText}
      openMenu={null}
      setOpenMenu={vi.fn()}
      setFilterText={vi.fn()}
      onCancelActive={vi.fn()}
      onExportCsv={vi.fn()}
      onExportJson={vi.fn()}
      onRunActive={vi.fn()}
      onRunActiveWithArpClear={vi.fn()}
    />
  );
}

describe('Toolbar filter hints', () => {
  it('are built once per result, not once per render', () => {
    const tab = { ...createTab('scan'), result: { kind: 'scan', data: [] } } as WorkspaceTab;
    vi.mocked(filterHintsFor).mockClear();

    const { rerender } = render(toolbar(tab, ''));
    rerender(toolbar(tab, 'status:open'));
    rerender(toolbar({ ...tab, selectedIndex: 3 }, 'status:open 22'));

    expect(filterHintsFor).toHaveBeenCalledTimes(1);
  });

  it('are built again for a new result', () => {
    const tab = { ...createTab('scan'), result: { kind: 'scan', data: [] } } as WorkspaceTab;
    vi.mocked(filterHintsFor).mockClear();

    const { rerender } = render(toolbar(tab, ''));
    rerender(toolbar({ ...tab, result: { kind: 'scan', data: [] } } as WorkspaceTab, ''));

    expect(filterHintsFor).toHaveBeenCalledTimes(2);
  });
});
