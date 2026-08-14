// @vitest-environment jsdom
//
// H-3 regression: the workspace tabs were plain divs with an onClick — no
// role, no tabIndex, and no tab-switching shortcut anywhere in the app — so
// they could not be reached or operated by keyboard at all.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TabStrip } from './TabStrip';
import { createTab } from '../../tools/registry';

function renderStrip(activeIndex = 0) {
  const tabs = [createTab('scan'), createTab('arp'), createTab('dns')];
  const onSelectTab = vi.fn();
  const onCloseTab = vi.fn();
  render(
    <TabStrip
      tabs={tabs}
      activeTabId={tabs[activeIndex].id}
      openMenu={null}
      toolCapabilities={{} as never}
      onAddScanTab={vi.fn()}
      onAddToolTab={vi.fn()}
      onCloseTab={onCloseTab}
      onSelectTab={onSelectTab}
      setOpenMenu={vi.fn()}
    />,
  );
  return { tabs, onSelectTab, onCloseTab };
}

describe('tab strip keyboard access', () => {
  it('exposes the tabs as a tablist', () => {
    renderStrip();
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks exactly one tab selected', () => {
    renderStrip(1);
    const selected = screen.getAllByRole('tab').filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
  });

  // Roving tabindex: the strip is a single tab stop, and arrows move within.
  it('puts only the active tab in the tab order', () => {
    renderStrip(1);
    const tabIndexes = screen.getAllByRole('tab').map((el) => el.getAttribute('tabindex'));
    expect(tabIndexes).toEqual(['-1', '0', '-1']);
  });

  it('moves to the next tab on ArrowRight and wraps at the end', () => {
    const { tabs, onSelectTab } = renderStrip(2);
    const active = screen.getAllByRole('tab')[2];
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onSelectTab).toHaveBeenCalledWith(tabs[0].id);
  });

  it('moves to the previous tab on ArrowLeft and wraps at the start', () => {
    const { tabs, onSelectTab } = renderStrip(0);
    screen.getAllByRole('tab')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onSelectTab).toHaveBeenCalledWith(tabs[2].id);
  });

  it('jumps to the ends with Home and End', () => {
    const { tabs, onSelectTab } = renderStrip(1);
    const active = screen.getAllByRole('tab')[1];
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(onSelectTab).toHaveBeenCalledWith(tabs[0].id);
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(onSelectTab).toHaveBeenCalledWith(tabs[2].id);
  });

  it('closes the focused tab with Delete', () => {
    const { tabs, onCloseTab } = renderStrip(1);
    screen.getAllByRole('tab')[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(onCloseTab).toHaveBeenCalledWith(tabs[1].id);
  });

  // A div does not activate on Enter/Space the way a button does, so this
  // needs an explicit handler rather than coming for free.
  it('activates a tab with Enter and Space', () => {
    const { tabs, onSelectTab } = renderStrip(0);
    const first = screen.getAllByRole('tab')[0];
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    first.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onSelectTab).toHaveBeenCalledTimes(2);
    expect(onSelectTab).toHaveBeenCalledWith(tabs[0].id);
  });
});
