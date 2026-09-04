import { Check, Copy, Terminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface CommandStripProps {
  command: string;
  onCopy: () => Promise<boolean>;
}

/** How long the button stays in its copied state.
 *
 *  Shorter than the website's 2500ms. A landing page holds it longer because
 *  a visitor may be reading elsewhere on the page when they click; here the
 *  pointer is on the control and the eye is already there, and a badge that
 *  outstays the moment reads as a state the button is stuck in. */
const COPIED_MS = 1400;

export function CommandStrip({ command, onCopy }: CommandStripProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // The button answers for itself.
  //
  // A successful copy used to say so through an `interaction` toast, and those
  // are off by default -- deliberately, because a new user otherwise meets the
  // app through a stream of notices about things they just did. The cost was
  // that at stock settings the one gesture whose whole result is invisible --
  // the clipboard -- gave no sign it had worked at all.
  //
  // Feedback on the control itself needs no setting, and it is where the eye
  // already is. Failures still go through reportActionFailure, which is not
  // gated.
  const handleClick = async () => {
    const ok = await onCopy();
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <section className="command-strip" data-testid="command-strip">
      <Terminal size={14} />
      <code>{command}</code>
      <button
        aria-label={copied ? 'Copied' : 'Copy command'}
        className={copied ? 'copied' : undefined}
        data-copied={copied ? 'true' : undefined}
        data-tooltip={copied ? 'Copied' : 'Copy Command'}
        data-tooltip-align="right"
        onClick={() => void handleClick()}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </section>
  );
}
