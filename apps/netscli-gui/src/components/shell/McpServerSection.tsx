import { Bot } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { openAllowedExternalUrl } from '../../services/externalLinks';
import { type CliDetection, detectNetscliCli } from '../../services/netscli';

/** Matches CommandStrip's badge duration, for the same reason: the pointer is
 *  already on the control, so a longer badge reads as a stuck state. */
const COPIED_MS = 1400;

const INSTALL_DOCS = 'https://netscli.com/docs/install/';

/** One command per platform, the same route the site recommends first.
 *
 *  Duplicated from the site rather than imported -- the two are separate
 *  packages with no shared module -- so this is a second copy that can drift.
 *  Kept to ONE command per platform to bound that: the link below carries
 *  every other route, and the docs page is the thing that has to stay correct.
 */
const INSTALL_COMMAND: Record<CliDetection['os'], string> = {
  windows: 'winget install netscli',
  macos: 'brew tap fstubner/tap && brew install netscli',
  linux: 'curl -fsSL https://netscli.com/install.sh | bash',
};

/** The block a user pastes into their MCP client.
 *
 *  Built with JSON.stringify rather than a template literal because a Windows
 *  path is full of backslashes: `C:\\Users\\...` has to reach the client's
 *  config file escaped, and hand-writing that escaping is how it gets missed
 *  on the one platform most desktop users are on.
 *
 *  The absolute path, not the bare name, for the reason the panel exists: an
 *  MCP client launched from the desktop session does not necessarily inherit
 *  the PATH a shell would, so `"command": "netscli"` fails for a client that
 *  a terminal would have resolved fine. */
function clientConfig(path: string): string {
  return JSON.stringify(
    { mcpServers: { netscli: { command: path, args: ['serve'] } } },
    null,
    2,
  );
}

/** A text button in the same style as Choose Folder and Reset above it. Its
 *  label turns to "Copied" for a moment, the way CommandStrip's badge does. */
function CopyButton({ value, label, testId }: { value: string; label: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleClick = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <button
      data-copied={copied ? 'true' : undefined}
      data-testid={testId}
      type="button"
      onClick={() => void handleClick()}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/** The MCP section, laid out as ordinary settings rows: a label and a one-line
 *  note on the left, text buttons on the right. It used to be a heading, a
 *  wrapped paragraph and a boxed code block, which read as a different dialog
 *  dropped into this one. */
export function McpServerSection() {
  const [detection, setDetection] = useState<CliDetection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detectNetscliCli()
      .then((result) => {
        if (!cancelled) setDetection(result);
      })
      // A detection failure and "not installed" lead to the same guidance, so
      // there is nothing for the user to do differently and no error state
      // worth its own copy. The os fallback keeps the install command present.
      .catch(() => {
        if (!cancelled) setDetection({ path: null, version: null, os: 'linux' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="settings-section settings-mcp" data-testid="settings-mcp-section">
      <span className="settings-section-label">
        <Bot size={13} />
        MCP Server
      </span>

      {detection === null ? (
        <div className="settings-folder-row">
          <div className="settings-row-copy">
            <span>Command-Line Tool</span>
            <small>Looking for netscli…</small>
          </div>
        </div>
      ) : detection.path ? (
        <>
          <div className="settings-folder-row">
            <div className="settings-row-copy">
              <span>Command-Line Tool</span>
              <small title={detection.path}>
                netscli {detection.version} at {detection.path}
              </small>
            </div>
          </div>
          <div className="settings-folder-row">
            <div className="settings-row-copy">
              <span>Agent Config</span>
              <small>Paste into your MCP client&apos;s config to let an agent run scans.</small>
            </div>
            <div className="settings-folder-actions">
              <CopyButton
                label="Copy Config"
                testId="settings-mcp-copy"
                value={clientConfig(detection.path)}
              />
            </div>
          </div>
          <details className="settings-mcp-details">
            <summary>Show config</summary>
            <pre data-testid="settings-mcp-config">{clientConfig(detection.path)}</pre>
          </details>
        </>
      ) : (
        <>
          <div className="settings-folder-row">
            <div className="settings-row-copy">
              <span>Command-Line Tool</span>
              <small>Not installed. The MCP server comes with it.</small>
            </div>
            <div className="settings-folder-actions">
              <button
                type="button"
                onClick={() =>
                  openAllowedExternalUrl(INSTALL_DOCS).catch((error: unknown) =>
                    console.error('Opening the link failed', error),
                  )
                }
              >
                Install Options
              </button>
            </div>
          </div>
          <div className="settings-folder-row">
            <div className="settings-row-copy">
              <span>Install Command</span>
              <small className="settings-mcp-command" data-testid="settings-mcp-install">
                {INSTALL_COMMAND[detection.os]}
              </small>
            </div>
            <div className="settings-folder-actions">
              <CopyButton
                label="Copy"
                testId="settings-mcp-copy"
                value={INSTALL_COMMAND[detection.os]}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
