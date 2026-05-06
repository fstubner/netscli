import type { SweepEntry } from '../types/netscli';
import * as netscli from '../services/netscli';
import type { ToolParams, ToolResult } from '../types/app';

interface ToolbarProps {
  busy: boolean;
  subnet: string;
  setSubnet: (v: string) => void;
  ports: string;
  setPorts: (v: string) => void;
  onRun: (params: ToolParams, exec: (op_id: string) => Promise<ToolResult>) => void;
  onCancel: () => void;
}

export function SweepToolbar({
  busy,
  subnet,
  setSubnet,
  ports,
  setPorts,
  onRun,
  onCancel,
}: ToolbarProps) {
  return (
    <div className="config-form">
      <div className="config-field">
        <label className="config-label">Subnet</label>
        <input
          className="config-input"
          value={subnet}
          onChange={(e) => setSubnet(e.target.value)}
          placeholder="192.168.1.0/24"
        />
      </div>
      <div className="config-field">
        <label className="config-label">Ports</label>
        <input
          className="config-input"
          value={ports}
          onChange={(e) => setPorts(e.target.value)}
          placeholder="80,443"
        />
      </div>
      <button
        className={`config-button ${busy ? 'cancel' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          if (busy) {
            onCancel();
          } else {
            onRun(
              { kind: 'sweep', subnet: subnet || undefined, ports: ports || undefined },
              async (op_id) => ({
                kind: 'sweep',
                data: await netscli.sweepNetwork(
                  subnet || undefined,
                  ports || undefined,
                  op_id,
                  true,
                ),
              }),
            );
          }
        }}
      >
        {busy ? 'Cancel Scan' : 'Start Sweep'}
      </button>
    </div>
  );
}

export function SweepResults({ data }: { data: SweepEntry[] }) {
  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">No results</div>
      </div>
    );
  }
  return (
    <div>
      {data.map((s) => (
        <div key={s.host.ip} className="host-card">
          <h4>
            {s.host.ip} {s.host.hostname && `(${s.host.hostname})`}
          </h4>
          {s.open_ports.length > 0 ? (
            <table className="results-table" style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr>
                  <th>Port</th>
                  <th>Service</th>
                </tr>
              </thead>
              <tbody>
                {s.open_ports.map((p) => (
                  <tr key={p.port}>
                    <td>{p.port}</td>
                    <td>{p.service || 'unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: '#999', fontSize: '0.875rem' }}>No open ports</div>
          )}
        </div>
      ))}
    </div>
  );
}
