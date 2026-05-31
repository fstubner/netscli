import { describe, expect, it } from 'vitest';

import { computePointPopoverPosition, computePopoverPosition } from './overlay';

describe('popover positioning', () => {
  it('places a start-aligned popover below the anchor when there is room', () => {
    expect(
      computePopoverPosition(
        { left: 40, right: 80, top: 20, bottom: 44 },
        { width: 160, height: 120, viewportWidth: 500, viewportHeight: 400 },
      ),
    ).toMatchObject({ left: 40, top: 48 });
  });

  it('flips above the anchor when the bottom edge would clip', () => {
    expect(
      computePopoverPosition(
        { left: 320, right: 360, top: 300, bottom: 326 },
        { align: 'end', width: 180, height: 140, viewportWidth: 400, viewportHeight: 360 },
      ),
    ).toMatchObject({ left: 180, top: 156 });
  });

  it('clamps point-positioned context menus inside the viewport', () => {
    expect(computePointPopoverPosition(390, 350, 160, 120, 400, 360)).toMatchObject({
      left: 232,
      top: 232,
    });
  });
});
