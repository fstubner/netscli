// @vitest-environment jsdom
//
// H-3 regression: the workspace tabs were plain divs with an onClick — no
// role, no tabIndex, and no tab-switching shortcut anywhere in the app — so
// they could not be reached or operated by keyboard at all.

import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TabStrip } from './TabStrip';
import { createTab } from '../../tools/registry';

function renderStrip(activeIndex = 0) {
  const tabs = [createTab('scan'), createTab('arp'), createTab('dns')];
  const onSelectTab = vi.fn();
  const onCloseTab = vi.fn();
  const onMoveTab = vi.fn();
  render(
    <TabStrip
      tabs={tabs}
      activeTabId={tabs[activeIndex].id}
      openMenu={null}
      toolCapabilities={{} as never}
      onAddScanTab={vi.fn()}
      onAddToolTab={vi.fn()}
      onCloseAllTabs={vi.fn()}
      onCloseOtherTabs={vi.fn()}
      onCloseTab={onCloseTab}
      onCloseTabsBeside={vi.fn()}
      onMoveTab={onMoveTab}
      onSelectTab={onSelectTab}
      setOpenMenu={vi.fn()}
    />,
  );
  return { tabs, onSelectTab, onCloseTab, onMoveTab };
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

  // Reordering is otherwise a pointer-only gesture, and this strip has been
  // keyboard-inoperable once already. Ctrl+Shift+Arrow is the same binding
  // editors use for it.
  it('moves the focused tab with Ctrl+Shift+Arrow', () => {
    const { tabs, onMoveTab } = renderStrip(1);
    const focused = screen.getAllByRole('tab')[1];

    focused.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(onMoveTab).toHaveBeenCalledWith(tabs[1].id, 2);

    focused.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(onMoveTab).toHaveBeenCalledWith(tabs[1].id, 0);
  });

  it('does not move a tab off either end', () => {
    const { onMoveTab } = renderStrip(0);
    screen.getAllByRole('tab')[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(onMoveTab).not.toHaveBeenCalled();
  });

  // Plain arrows still change selection; the modifier is what distinguishes
  // "move between tabs" from "move the tab".
  it('leaves plain-arrow selection alone', () => {
    const { tabs, onSelectTab, onMoveTab } = renderStrip(0);
    screen.getAllByRole('tab')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onSelectTab).toHaveBeenCalledWith(tabs[1].id);
    expect(onMoveTab).not.toHaveBeenCalled();
  });
});

/**
 * The strip with real reordering, which `renderStrip` cannot do: its
 * `onMoveTab` is a mock, so the tabs never actually move and anything that
 * depends on the re-render -- focus, most of all -- is invisible to it. That
 * is why "moves the focused tab with Ctrl+Shift+Arrow" above passed while
 * focus was being left behind.
 */
function StatefulStrip() {
  const [tabs, setTabs] = useState(() => [createTab('scan'), createTab('arp'), createTab('dns')]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  return (
    <TabStrip
      tabs={tabs}
      activeTabId={activeTabId}
      openMenu={null}
      toolCapabilities={{} as never}
      onAddScanTab={vi.fn()}
      onAddToolTab={vi.fn()}
      onCloseAllTabs={vi.fn()}
      onCloseOtherTabs={vi.fn()}
      onCloseTab={vi.fn()}
      onCloseTabsBeside={vi.fn()}
      onMoveTab={(tabId, toIndex) => {
        setTabs((previous) => {
          const from = previous.findIndex((tab) => tab.id === tabId);
          if (from < 0) return previous;
          const next = [...previous];
          const [moved] = next.splice(from, 1);
          next.splice(toIndex, 0, moved);
          return next;
        });
      }}
      onSelectTab={setActiveTabId}
      setOpenMenu={vi.fn()}
    />
  );
}

describe('moving a tab with the keyboard', () => {
  const move = (element: HTMLElement, key: string) =>
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, bubbles: true }),
      );
    });

  it('carries focus with the tab, so a repeated press keeps moving the same one', () => {
    render(<StatefulStrip />);
    const before = screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'));
    const moved = screen.getAllByRole('tab')[0];
    moved.focus();

    move(moved, 'ArrowRight');

    const afterOne = screen.getAllByRole('tab');
    expect(afterOne.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      before[1], before[0], before[2],
    ]);
    // The whole point: focus is on the tab that moved, not on the slot it left.
    expect(document.activeElement).toBe(moved);
    expect(afterOne[1]).toBe(moved);

    // Pressing again must carry the same tab onward rather than swapping the
    // pair back and forth, which is what happens when focus stays put.
    move(document.activeElement as HTMLElement, 'ArrowRight');

    const afterTwo = screen.getAllByRole('tab');
    expect(afterTwo.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      before[1], before[2], before[0],
    ]);
    expect(afterTwo[2]).toBe(moved);
  });

  it('leaves focus alone at the end of the strip, where there is no move to make', () => {
    render(<StatefulStrip />);
    const last = screen.getAllByRole('tab')[2];
    last.focus();

    move(last, 'ArrowRight');

    expect(screen.getAllByRole('tab')[2]).toBe(last);
    expect(document.activeElement).toBe(last);
  });
});
