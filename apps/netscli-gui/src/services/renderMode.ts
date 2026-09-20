import { invoke } from '@tauri-apps/api/core';

/**
 * Tell the Rust side that the UI actually drew something.
 *
 * This is the half of the compositing safe mode that lives in the webview.
 * `main.rs` arms a marker on every launch; if a later launch still finds it
 * armed, it concludes the previous one never got this far and turns hardware
 * compositing off. See src-tauri/src/render_mode.rs.
 *
 * Two animation frames, not one, and not a bare `useEffect`. A mounted React
 * tree is not a painted one -- the effect runs before the browser has composited
 * anything, which is exactly the step that fails on the hosts this exists for.
 * The second frame only runs once the first has been through paint.
 */
export function reportFirstPaint(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Best effort. A failure here costs one spurious safe-mode entry on the
      // next launch, which the user can undo; throwing during startup would be
      // worse than the problem.
      void invoke('report_first_paint').catch(() => {});
    });
  });
}
