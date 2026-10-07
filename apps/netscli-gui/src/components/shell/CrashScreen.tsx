import { appWindowAction } from '../../services/appWindow';
import { AppFrame } from './AppFrame';
import { handleAppFrameMouseDown } from './appFrameDrag';

/**
 * What replaces the window when a render throws. See `ErrorBoundary`.
 *
 * Two things the first version of this lacked, both from the same cause: it
 * renders where nothing of the app is mounted.
 *
 * The colour tokens are defined on `.container` alone, so outside it the text
 * took the operating system's colour on a page that is dark whatever the
 * theme, which is black on near-black for anyone on a light theme. And the
 * window has no native title bar (`decorations: false`), so with the app's own
 * frame gone there was nothing to move, minimise or close it with.
 */
export function CrashScreen({ error }: { error: Error }) {
  return (
    <div className="container theme-dark">
      <AppFrame
        onDragStart={handleAppFrameMouseDown}
        onWindowAction={(action) => void appWindowAction(action)}
      >
        {null}
      </AppFrame>
      <div className="error-boundary" role="alert" data-testid="error-boundary">
        <h1>Something went wrong</h1>
        <p>
          The window stopped rendering and could not recover. Reloading starts a fresh session; any
          results still open will be lost.
        </p>
        <pre className="error-boundary-detail">{error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
