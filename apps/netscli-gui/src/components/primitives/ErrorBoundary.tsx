import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence against a render throw blanking the window.
 *
 * There was no boundary anywhere in the app, so any error thrown during
 * render unmounted the whole tree and left a blank window -- taking every
 * other tab's results and form state with it. An imported result bundle is
 * the realistic trigger: bundles are shareable files, and the row builders
 * run inside a `useMemo`, which no `try`/`catch` around the import can
 * reach.
 *
 * Deliberately not a retry button. Whatever produced the error is still in
 * state, so re-rendering the same tree reproduces it; reloading is the
 * honest offer, and the message says what to expect from it.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Nothing here reaches a server; this is the developer console of the
    // user's own machine, and the component stack is what makes a report
    // actionable.
    console.error('Unrecoverable render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
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
    );
  }
}
