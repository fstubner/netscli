import { Bot, Check, Copy, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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

function CopyButton({ value, label }: { value: string; label: string }) {
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
      aria-label={copied ? 'Copied' : label}
      className={copied ? 'copied' : undefined}
      data-copied={copied ? 'true' : undefined}
      data-testid="settings-mcp-copy"
      type="button"
      onClick={() => void handleClick()}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

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
        <div className="settings-row-copy">
          <small>Looking for the netscli command-line tool…</small>
        </div>
      ) : detection.path ? (
        <>
          <div className="settings-row-copy">
            <span>Ready to connect</span>
            <small>
              Paste this into your MCP client&apos;s config to let an agent run network
              scans. Found netscli {detection.version} at {detection.path}
            </small>
          </div>
          <div className="settings-mcp-config">
            <pre data-testid="settings-mcp-config">{clientConfig(detection.path)}</pre>
            <CopyButton label="Copy MCP config" value={clientConfig(detection.path)} />
          </div>
        </>
      ) : (
        <>
          <div className="settings-row-copy">
            <span>Command-line tool not found</span>
            <small>
              The MCP server is part of the netscli command-line tool, which installs
              separately from this app. Install it and reopen Settings to get a config
              block for your agent.
            </small>
          </div>
          <div className="settings-mcp-config">
            <pre data-testid="settings-mcp-install">{INSTALL_COMMAND[detection.os]}</pre>
            <CopyButton label="Copy install command" value={INSTALL_COMMAND[detection.os]} />
          </div>
          <a
            className="settings-mcp-link"
            href={INSTALL_DOCS}
            rel="noreferrer"
            target="_blank"
          >
            All install options
            <ExternalLink size={11} />
          </a>
        </>
      )}
    </section>
  );
}
