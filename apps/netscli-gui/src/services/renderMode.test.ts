import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { reportFirstPaint } = await import('./renderMode');

/**
 * This exists because of what breaks if the reporter stops working.
 *
 * `render_mode.rs` arms a marker on every launch and concludes, on the next
 * one, that a still-armed marker means the UI never painted -- so it turns
 * hardware compositing off. If this call is deleted, renamed, or moved
 * somewhere it no longer runs, then nothing clears the marker, and every Linux
 * user loses hardware compositing on their second launch. Nothing else in the
 * suite would notice: the app looks and behaves the same, only slower, and the
 * e2e render harness does not run on CI.
 */
describe('reportFirstPaint', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it('waits for a painted frame rather than reporting on mount', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });

    reportFirstPaint();
    expect(invoke).not.toHaveBeenCalled();

    frames.shift()?.(0);
    expect(invoke, 'one frame is scheduled, not yet painted').not.toHaveBeenCalled();

    frames.shift()?.(0);
    expect(invoke).toHaveBeenCalledWith('report_first_paint');
  });

  it('swallows a failed call instead of throwing during startup', async () => {
    invoke.mockRejectedValue(new Error('no backend'));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    expect(() => reportFirstPaint()).not.toThrow();
    await Promise.resolve();
  });
});
