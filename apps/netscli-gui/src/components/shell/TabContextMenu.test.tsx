// @vitest-environment jsdom
// The tab context menu acts on the tab that was right-clicked, and disables
// what would do nothing. Both matter: right-clicking a background tab and
// getting "close others" applied to the *active* one silently closes the tab
// you were pointing at, and an enabled item that does nothing reads as a bug.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TabContextMenu, type TabContextTarget } from './TabContextMenu';

function renderMenu(target: Partial<TabContextTarget> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseBeside: vi.fn(),
    onCloseAll: vi.fn(),
  };
  render(
    <TabContextMenu
      target={{ tabId: 'b', index: 1, total: 3, x: 20, y: 20, ...target }}
      {...handlers}
    />,
  );
  return handlers;
}

const item = (label: string) =>
  screen.getByRole('menuitem', { name: label }) as HTMLButtonElement;

describe('tab context menu', () => {
  it('acts on the tab that was clicked, not the active one', () => {
    const h = renderMenu({ tabId: 'clicked' });

    fireEvent.click(item('Close others'));

    expect(h.onCloseOthers).toHaveBeenCalledWith('clicked');
  });

  it('closes to the side that was asked for', () => {
    const h = renderMenu({ tabId: 'middle', index: 1, total: 3 });

    fireEvent.click(item('Close to the right'));
    fireEvent.click(item('Close to the left'));

    expect(h.onCloseBeside).toHaveBeenNthCalledWith(1, 'middle', 'right');
    expect(h.onCloseBeside).toHaveBeenNthCalledWith(2, 'middle', 'left');
  });

  it('disables the directions with nothing in them', () => {
    renderMenu({ index: 0, total: 3 });

    expect(item('Close to the left').disabled).toBe(true);
    expect(item('Close to the right').disabled).toBe(false);
  });

  it('disables close others on the only tab, and never disables close', () => {
    renderMenu({ index: 0, total: 1 });

    expect(item('Close others').disabled).toBe(true);
    expect(item('Close to the right').disabled).toBe(true);
    expect(item('Close').disabled).toBe(false);
  });

  it('dismisses itself after acting, so the menu does not outlive the tab', () => {
    const h = renderMenu();

    fireEvent.click(item('Close'));

    expect(h.onCloseTab).toHaveBeenCalledWith('b');
    expect(h.onClose).toHaveBeenCalled();
  });
});
