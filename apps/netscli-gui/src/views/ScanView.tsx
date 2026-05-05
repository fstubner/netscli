import type { PortResult } from '../types/netscli';
import * as netscli from '../services/netscli';
import type { ToolParams, ToolResult } from '../types/app';

interface ToolbarProps {
  busy: boolean;
  host: string;
  setHost: (v: string) => void;
  ports: string;
  setPorts: (v: string) => void;
  validationErrors: Record<string, string | null>;
  setValidationErrors: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  onRun: (params: ToolParams, exec: (op_id: string) => Promise<ToolResult>) => void;
  onCancel: () => void;
}

export function ScanToolbar({
  busy,
  host,
  setHost,
  ports,
  setPorts,
  validationErrors,
  setValidationErrors,
  onRun,
  onCancel,
}: ToolbarProps) {
  return (
    <div className="config-form">
      <div className="config-field">
        <label className="config-label">
          Host <span className="required">*</span>
        </label>
        <input
          className={`config-input ${validationErrors.host ? 'input-error' : ''}`}
          value={host}
          onChange={(e) => {
            setHost(e.target.value);
            setValidationErrors((prev) => ({ ...prev, host: null }));
          }}
          placeholder="192.168.1.1"
        />
        {validationErrors.host && (
          <span className="validation-error">{validationErrors.host}</span>
        )}
      </div>
      <div className="config-field">
        <label className="config-label">Ports</label>
        <input
          className="config-input"
          value={ports}
          onChange={(e) => setPorts(e.target.value)}
          placeholder="22,80,443"
        />
      </div>
      <button
        className={`config-button ${busy ? 'cancel' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          if (busy) {
            onCancel();
            return;
          }
          if (host.trim() === '') {
            setValidationErrors((prev) => ({ ...prev, host: 'Host is required' }));
            return;
          }
          setValidationErrors((prev) => ({ ...prev, host: null }));
          onRun(
            { kind: 'scan', host, ports: ports || undefined },
            async (op_id) => ({
              kind: 'scan',
              data: await netscli.scanPorts(host, ports || undefined, op_id),
            }),
          );
        }}
      >
        {busy ? 'Cancel Scan' : 'Start Scan'}
      </button>
    </div>
  );
}

export function ScanResults({ data }: { data: PortResult[] }) {
  const openPorts = data.filter((p) => p.open);
  if (openPorts.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">No open ports found</div>
      </div>
    );
  }
  return (
    <table className="results-table">
      <thead>
        <tr>
          <th>Port</th>
          <th>Service</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {openPorts.map((p) => (
          <tr key={p.port}>
            <td>{p.port}</td>
            <td>{p.service || 'unknown'}</td>
            <td>
              <span style={{ color: '#00a86b', fontWeight: 500 }}>OPEN</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
