import { useEffect } from 'react';
import { ExternalLink, Scale, User, X } from 'lucide-react';

import { openAllowedExternalUrl } from '../../services/externalLinks';

interface AboutDialogProps {
  appVersion: string;
  onClose: () => void;
}

export function AboutDialog({ appVersion, onClose }: AboutDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function openProjectUrl(url: string) {
    void openAllowedExternalUrl(url);
  }

  return (
    <div className="about-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="about-title"
        aria-modal="true"
        className="about-dialog"
        data-testid="about-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="about-close" aria-label="Close" data-tooltip="Close" onClick={onClose}>
          <X size={15} />
        </button>
        <AboutLogoMark />
        <div className="about-heading">
          <h2 id="about-title">NetsCLI Desktop</h2>
          <p className="about-version">Version {appVersion}</p>
        </div>
        <p>
          A desktop shell for NetsCLI network discovery, port scanning, DNS lookup, packet capture,
          and CLI-equivalent workflows.
        </p>
        <div className="about-meta">
          <span>
            <User size={12} />
            Felix Stubner
          </span>
          <span>
            <Scale size={12} />
            MIT licensed
          </span>
          <span>Rust core</span>
          <span>Tauri desktop</span>
        </div>
        <div className="about-links">
          <button onClick={() => openProjectUrl('https://github.com/fstubner/netscli')}>
            <GitHubIcon size={14} />
            GitHub
          </button>
          <button onClick={() => openProjectUrl('https://github.com/fstubner/netscli/releases/latest')}>
            <ExternalLink size={14} />
            Releases
          </button>
          <button onClick={() => openProjectUrl('https://github.com/fstubner/netscli#readme')}>
            <ExternalLink size={14} />
            README
          </button>
        </div>
      </section>
    </div>
  );
}

function AboutLogoMark() {
  return (
    <svg className="about-mark" viewBox="0 0 64 64" role="img" aria-label="NetsCLI">
      <defs>
        <linearGradient id="about-mark-gradient" x1="0" y1="0" x2="64" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#005a1e" />
          <stop offset="45%" stopColor="#0aae7a" />
          <stop offset="100%" stopColor="#1edcff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="9" fill="#111111" />
      <g
        fill="url(#about-mark-gradient)"
        fontFamily='ui-monospace, "Cascadia Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
        fontSize="7.4"
        fontWeight="400"
        textAnchor="middle"
      >
        <text x="32" y="18" xmlSpace="preserve">███╗   ██╗</text>
        <text x="32" y="25.4" xmlSpace="preserve">████╗  ██║</text>
        <text x="32" y="32.8" xmlSpace="preserve">██╔██╗ ██║</text>
        <text x="32" y="40.2" xmlSpace="preserve">██║╚██╗██║</text>
        <text x="32" y="47.6" xmlSpace="preserve">██║ ╚████║</text>
        <text x="32" y="55" xmlSpace="preserve">╚═╝  ╚═══╝</text>
      </g>
    </svg>
  );
}

function GitHubIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      className="github-icon"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.38-3.37-1.38-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.32 9.32 0 0 1 12 6.98c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.16 10.16 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"
      />
    </svg>
  );
}
