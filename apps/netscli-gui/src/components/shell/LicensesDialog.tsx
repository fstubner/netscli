import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { getThirdPartyNotices } from '../../services/netscli';
import { useModalFocus } from '../primitives/focus';

type Notices = { kind: 'loading' } | { kind: 'loaded'; text: string } | { kind: 'failed'; message: string };

/** The third-party license notices, opened from the About dialog. */
export function LicensesDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [notices, setNotices] = useState<Notices>({ kind: 'loading' });
  useModalFocus({ dialogRef, onClose });

  useEffect(() => {
    let current = true;
    getThirdPartyNotices()
      .then((text) => current && setNotices({ kind: 'loaded', text }))
      .catch((error: unknown) => current && setNotices({ kind: 'failed', message: String(error) }));
    return () => {
      current = false;
    };
  }, []);

  return (
    <div className="about-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="licenses-title"
        aria-modal="true"
        className="licenses-dialog"
        data-testid="licenses-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="about-close" aria-label="Close" data-tooltip="Close" onClick={onClose}>
          <X size={15} />
        </button>
        <div className="about-heading">
          <h2 id="licenses-title">Third-party licenses</h2>
          <p className="about-version">Open source code built into NetsCLI Desktop</p>
        </div>
        {notices.kind === 'loaded' ? (
          // Focusable so the keyboard can scroll it.
          <pre className="licenses-text" tabIndex={0}>
            {notices.text}
          </pre>
        ) : (
          <p className="licenses-status" role={notices.kind === 'failed' ? 'alert' : undefined}>
            {notices.kind === 'loading'
              ? 'Loading…'
              : `The notices could not be read. ${notices.message}`}
          </p>
        )}
      </section>
    </div>
  );
}
