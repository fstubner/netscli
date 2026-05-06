import type { PcapResult } from '../types/netscli';
import * as netscli from '../services/netscli';
import type { ToolParams, ToolResult } from '../types/app';

const PCAP_TIPS_BASE: string[] = [
  'Pick an interface name from the Interfaces tab (e.g., eth0, wlan0, en0).',
  'PCAP capture often requires elevated privileges (root/admin) depending on OS and config.',
  'On Linux you may need libpcap installed and/or capabilities set for packet capture.',
  'On Windows, install Npcap (WinPcap-compatible mode) if capture is unavailable.',
];

/**
 * Synthesize PCAP guidance bullets, hoisting hints to the top when the
 * error message hints at the cause (interface-not-found, permissions,
 * pcap-unavailable). Pure helper so the pcap tab can reuse it for both
 * the inline tips banner and the post-error info panel.
 */
export function pcapGuidance(err: string | null): string[] {
  const tips = [...PCAP_TIPS_BASE];
  if (!err) return tips;

  const e = err.toLowerCase();
  if (e.includes('interface not found')) {
    tips.unshift('The selected interface was not found. Double-check the exact name.');
  }
  if (
    e.includes('permission') ||
    e.includes('operation not permitted') ||
    e.includes('access is denied')
  ) {
    tips.unshift(
      'This looks like a permissions issue. Try running as admin/root or granting capture capabilities.',
    );
  }
  if (e.includes('pcap unavailable') || e.includes('pcap support disabled')) {
    tips.unshift(
      'PCAP appears unavailable in this build/environment. Install libpcap/Npcap or use a build with PCAP enabled.',
    );
  }
  return tips;
}

interface ToolbarProps {
  busy: boolean;
  pcapInterface: string;
  setPcapInterface: (v: string) => void;
  pcapDuration: string;
  setPcapDuration: (v: string) => void;
  validationErrors: Record<string, string | null>;
  setValidationErrors: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  error: string | null;
  onRun: (params: ToolParams, exec: (op_id: string) => Promise<ToolResult>) => void;
  onCancel: () => void;
}

export function PcapToolbar({
  busy,
  pcapInterface,
  setPcapInterface,
  pcapDuration,
  setPcapDuration,
  validationErrors,
  setValidationErrors,
  error,
  onRun,
  onCancel,
}: ToolbarProps) {
  return (
    <div className="config-form">
      <div className="info-banner" style={{ margin: '0 0 1rem 0' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>PCAP tips</div>
        <ul>
          {pcapGuidance(error)
            .slice(0, 4)
            .map((t) => (
              <li key={t}>{t}</li>
            ))}
        </ul>
      </div>
      <div className="config-field">
        <label className="config-label">
          Interface <span className="required">*</span>
        </label>
        <input
          className={`config-input ${validationErrors.pcapInterface ? 'input-error' : ''}`}
          value={pcapInterface}
          onChange={(e) => {
            setPcapInterface(e.target.value);
            setValidationErrors((prev) => ({ ...prev, pcapInterface: null }));
          }}
          placeholder="eth0"
        />
        {validationErrors.pcapInterface && (
          <span className="validation-error">{validationErrors.pcapInterface}</span>
        )}
      </div>
      <div className="config-field">
        <label className="config-label">Duration (seconds, 1–3600)</label>
        <input
          className={`config-input ${validationErrors.pcapDuration ? 'input-error' : ''}`}
          type="number"
          min={1}
          max={3600}
          value={pcapDuration}
          onChange={(e) => {
            setPcapDuration(e.target.value);
            setValidationErrors((prev) => ({ ...prev, pcapDuration: null }));
          }}
          placeholder="5"
        />
        {validationErrors.pcapDuration && (
          <span className="validation-error">{validationErrors.pcapDuration}</span>
        )}
      </div>
      <button
        className={`config-button ${busy ? 'cancel' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          if (busy) {
            onCancel();
            return;
          }
          // Validate before firing: the backend clamps duration to
          // (1, 3600] but the user deserves an inline error instead
          // of a round-trip for an obviously bad input.
          if (pcapInterface.trim() === '') {
            setValidationErrors((prev) => ({ ...prev, pcapInterface: 'Interface is required' }));
            return;
          }
          const duration = Number.parseInt(pcapDuration, 10);
          if (!Number.isFinite(duration) || duration <= 0) {
            setValidationErrors((prev) => ({
              ...prev,
              pcapDuration: 'Duration must be a positive number of seconds',
            }));
            return;
          }
          if (duration > 3600) {
            setValidationErrors((prev) => ({
              ...prev,
              pcapDuration: 'Duration capped at 3600 seconds (1 hour)',
            }));
            return;
          }
          setValidationErrors((prev) => ({
            ...prev,
            pcapInterface: null,
            pcapDuration: null,
          }));
          onRun(
            { kind: 'pcap', interface: pcapInterface, duration },
            async (op_id) => ({
              kind: 'pcap',
              data: await netscli.capturePcap(
                { interface: pcapInterface, duration },
                op_id,
              ),
            }),
          );
        }}
      >
        {busy ? 'Cancel' : 'Start Capture'}
      </button>
    </div>
  );
}

export function PcapResults({ data }: { data: PcapResult }) {
  // Duration comes across as { secs, nanos }; flatten to a human-readable
  // seconds value with one decimal.
  const durSecs = data.duration.secs + data.duration.nanos / 1e9;
  return (
    <div className="pcap-summary">
      <div className="pcap-stat">
        <div className="pcap-stat-label">Packets captured</div>
        <div className="pcap-stat-value">{data.packets_captured.toLocaleString()}</div>
      </div>
      <div className="pcap-stat">
        <div className="pcap-stat-label">Duration</div>
        <div className="pcap-stat-value">{durSecs.toFixed(2)} s</div>
      </div>
      <div className="pcap-stat pcap-stat-path">
        <div className="pcap-stat-label">Output file</div>
        <div className="pcap-stat-value mono-cell" title={data.file_path}>
          {data.file_path}
        </div>
      </div>
    </div>
  );
}
