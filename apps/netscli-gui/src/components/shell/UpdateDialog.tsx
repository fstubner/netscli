import { Download, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { useModalFocus } from '../primitives/focus';

interface UpdateDialogProps {
  currentVersion: string;
  version: string;
  notes: string | undefined;
  /** Downloads, verifies, installs and restarts. Resolves only if the
   *  restart did not happen, which is itself a failure worth showing. */
  onInstall: (onProgress: (fraction: number | null) => void) => Promise<void>;
  onLater: () => void;
  onSkip: () => void;
  onOpenReleasePage: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'installing'; fraction: number | null }
  | { kind: 'failed'; message: string };

export function UpdateDialog({
  currentVersion,
  version,
  notes,
  onInstall,
  onLater,
  onSkip,
  onOpenReleasePage,
}: UpdateDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const busy = phase.kind === 'installing';

  // Escape and the backdrop do nothing mid-install. Closing the dialog would
  // not stop the download, only hide the one thing saying it is happening.
  const close = () => {
    if (!busy) onLater();
  };
  useModalFocus({ dialogRef, onClose: close });

  async function install() {
    setPhase({ kind: 'installing', fraction: null });
    try {
      await onInstall((fraction) => setPhase({ kind: 'installing', fraction }));
      // Reaching here means the files were replaced but the restart did not
      // happen. The new version is on disk; the user just has to reopen.
      setPhase({
        kind: 'failed',
        message: `NetsCLI ${version} is installed. Close and reopen the app to start using it.`,
      });
    } catch (error) {
      setPhase({ kind: 'failed', message: describe(error) });
    }
  }

  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={close}>
      <section
        aria-labelledby="update-title"
        aria-describedby="update-summary"
        aria-modal="true"
        className="confirm-dialog update-dialog"
        data-testid="update-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="confirm-dialog-header">
          <span className="update-dialog-icon" aria-hidden="true">
            <Download size={17} />
          </span>
          <div>
            <h2 id="update-title">NetsCLI {version} is available</h2>
            <p id="update-summary">
              You have {currentVersion}. The update is checked against NetsCLI&apos;s signing key
              before it installs, and the app restarts to finish.
            </p>
          </div>
          <button
            className="dialog-close"
            aria-label="Close"
            disabled={busy}
            type="button"
            onClick={close}
          >
            <X size={15} />
          </button>
        </header>

        {notes && (
          <div className="update-dialog-notes" data-testid="update-notes">
            {notes}
          </div>
        )}

        <div className="update-dialog-status" role="status" aria-live="polite">
          {phase.kind === 'installing' && progressLabel(phase.fraction)}
          {phase.kind === 'failed' && phase.message}
        </div>

        <div className="confirm-dialog-actions">
          {phase.kind === 'failed' ? (
            <>
              <button type="button" onClick={onOpenReleasePage}>
                Open release page
              </button>
              <button className="primary" type="button" onClick={onLater}>
                Close
              </button>
            </>
          ) : (
            <>
              <button className="update-dialog-skip" disabled={busy} type="button" onClick={onSkip}>
                Skip this version
              </button>
              <button disabled={busy} type="button" onClick={onLater}>
                Later
              </button>
              <button className="primary" disabled={busy} type="button" onClick={() => void install()}>
                Install and restart
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function progressLabel(fraction: number | null): string {
  if (fraction === null) return 'Downloading…';
  if (fraction >= 1) return 'Installing…';
  return `Downloading… ${Math.round(fraction * 100)}%`;
}

/** Plugin errors arrive as strings; everything else as Error or unknown. */
function describe(error: unknown): string {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return detail
    ? `The update could not be installed: ${detail}`
    : 'The update could not be installed.';
}
