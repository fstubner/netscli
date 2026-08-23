// @vitest-environment jsdom
//
// A popover that this hook does not recognise is not merely left unprotected.
// The listeners run in the CAPTURE phase on pointerdown, mousedown and click,
// so an unrecognised popover is torn down before its own item's onClick can
// fire: the item does nothing, throws nothing, and logs nothing. The
// run-options menu shipped in exactly that state and read as a dead button.

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { usePopoverDismissal } from './usePopoverDismissal';

function mount(openMenu: string | null, setOpenMenu: (menu: string | null) => void) {
  return renderHook(() =>
    usePopoverDismissal({
      contentContextMenu: null,
      setContentContextMenu: () => undefined,
      openMenu,
      setOpenMenu,
    }),
  );
}

function pointerDownOn(element: Element) {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
}

describe('popover dismissal', () => {
  let setOpenMenu: Mock<(menu: string | null) => void>;

  beforeEach(() => {
    setOpenMenu = vi.fn();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves a popover alone when the press lands inside it', () => {
    document.body.innerHTML =
      '<div data-popover="run-options"><button id="item">Clear ARP table</button></div>';
    mount('run-options', setOpenMenu);

    pointerDownOn(document.getElementById('item')!);

    // Not closing here is what lets the item's own click handler run at all.
    expect(setOpenMenu).not.toHaveBeenCalled();
  });

  it('closes it when the press lands outside', () => {
    document.body.innerHTML =
      '<div data-popover="run-options"></div><div id="elsewhere"></div>';
    mount('run-options', setOpenMenu);

    pointerDownOn(document.getElementById('elsewhere')!);

    expect(setOpenMenu).toHaveBeenCalledWith(null);
  });

  it('only protects the popover that is actually open', () => {
    // A stale marker from another menu must not keep this one alive.
    document.body.innerHTML = '<div data-popover="advanced-filter" id="other"></div>';
    mount('run-options', setOpenMenu);

    pointerDownOn(document.getElementById('other')!);

    expect(setOpenMenu).toHaveBeenCalledWith(null);
  });

  it('still protects the menus that predate the data attribute', () => {
    document.body.innerHTML = '<div class="menu-popover"><button id="entry">Open</button></div>';
    mount('File', setOpenMenu);

    pointerDownOn(document.getElementById('entry')!);

    expect(setOpenMenu).not.toHaveBeenCalled();
  });
});
