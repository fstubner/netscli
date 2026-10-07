// @vitest-environment jsdom
//
// Escape has two meanings here: stop the run, and close whatever is open. The
// run must only be stopped when nothing is open, because the close is done by
// a listener that runs after this one and would otherwise find a run already
// cancelled and the user none the wiser about why.

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTab } from '../tools/registry';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function mountWithRunningTab() {
  const cancelTab = vi.fn(() => Promise.resolve());
  const workspace = { activeTab: { ...createTab('scan'), busy: true }, cancelTab } as never;
  renderHook(() =>
    useKeyboardShortcuts({
      focusResultFilter: vi.fn(),
      openMenu: null,
      requestRun: vi.fn(),
      setOpenMenu: vi.fn(),
      setSettingsOpen: vi.fn(),
      settingsOpen: false,
      setWorkspaceSearchOpen: vi.fn(),
      workspace,
      workspaceSearchOpen: false,
    }),
  );
  return cancelTab;
}

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Escape while a run is active', () => {
  it('stops the run when nothing else is open', () => {
    const cancelTab = mountWithRunningTab();
    pressEscape();
    expect(cancelTab).toHaveBeenCalledTimes(1);
  });

  it.each(['dialog', 'menu'])('leaves the run alone while a %s is open', (role) => {
    const cancelTab = mountWithRunningTab();
    document.body.innerHTML = `<div role="${role}"></div>`;
    pressEscape();
    expect(cancelTab).not.toHaveBeenCalled();
  });
});
