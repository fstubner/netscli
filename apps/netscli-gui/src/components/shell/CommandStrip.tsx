import { Copy, Terminal } from 'lucide-react';

interface CommandStripProps {
  command: string;
  onCopy: () => void;
}

export function CommandStrip({ command, onCopy }: CommandStripProps) {
  return (
    <section className="command-strip" data-testid="command-strip">
      <Terminal size={14} />
      <code>{command}</code>
      <button
        aria-label="Copy command"
        data-tooltip="Copy Command"
        data-tooltip-align="right"
        onClick={onCopy}
      >
        <Copy size={13} />
      </button>
    </section>
  );
}
