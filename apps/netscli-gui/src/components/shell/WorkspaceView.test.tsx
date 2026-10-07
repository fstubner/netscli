// @vitest-environment jsdom
//
// The parts of the workspace that speak to a screen reader: a failed run and
// the run's progress. Neither is visible in a snapshot or caught by a type, and
// both went unannounced at stock settings until these were added, so the test
// goes through the real view rather than the pieces.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceTab } from '../../tools/types';

// The table, form and detail pane have nothing to say about announcements and
// need a great deal of state to render.
vi.mock('../results/ResultTable', () => ({ ResultTable: () => null }));
vi.mock('../results/DetailPane', () => ({ DetailPane: () => null }));
vi.mock('../tools/ToolForm', () => ({ ToolForm: () => null }));

const { WorkspaceView } = await import('./WorkspaceView');
const { createTab } = await import('../../tools/registry');

function view(tab: WorkspaceTab) {
  const workspace = {
    activeTab: tab,
    columns: [],
    commandPreview: 'netscli scan 127.0.0.1',
    copyCommand: vi.fn(),
    filterText: '',
    interfaces: [],
    patchForm: vi.fn(),
    patchTab: vi.fn(),
    rows: [],
    selectedRows: [],
  } as never;
  return (
    <WorkspaceView
      commandBarVisible={false}
      pcapCapability={{ compiled: true, available: true, interfaces: [], message: null }}
      toolCapabilities={{}}
      workspace={workspace}
      onContentContextMenu={vi.fn()}
      onRequestRun={vi.fn()}
    />
  );
}

describe('WorkspaceView announcements', () => {
  it('announces a failed run as an alert', () => {
    render(view({ ...createTab('scan'), error: 'Host is required' }));
    expect(screen.getByRole('alert').textContent).toBe('Host is required');
  });

  it('says nothing when there is no error', () => {
    render(view(createTab('scan')));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces the start of a run without any setting turned on', () => {
    const tab = createTab('scan');
    const { rerender } = render(view(tab));
    expect(screen.getByRole('status').textContent).toBe('');

    rerender(view({ ...tab, busy: true }));
    expect(screen.getByRole('status').textContent).toBe('Port Scan started');
  });
});
