import type { Host } from '../types/netscli';
import * as netscli from '../services/netscli';
import type { ToolParams, ToolResult } from '../types/app';

interface ToolbarProps {
  busy: boolean;
  subnet: string;
  setSubnet: (v: string) => void;
  onRun: (params: ToolParams, exec: (op_id: string) => Promise<ToolResult>) => void;
  onCancel: () => void;
}

export function DiscoverToolbar({ busy, subnet, setSubnet, onRun, onCancel }: ToolbarProps) {
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
      <button
        className={`config-button ${busy ? 'cancel' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          if (busy) {
            onCancel();
          } else {
            onRun(
              { kind: 'discover', subnet: subnet || undefined },
              async (op_id) => ({
                kind: 'discover',
                data: await netscli.discoverNetwork(subnet || undefined, op_id, true),
              }),
            );
          }
        }}
      >
        {busy ? 'Cancel Scan' : 'Start Scan'}
      </button>
    </div>
  );
}

export function DiscoverResults({ data }: { data: Host[] }) {
  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">No hosts discovered</div>
      </div>
    );
  }
  return (
    <table className="results-table">
      <thead>
        <tr>
          <th>IP Address</th>
          <th>MAC Address</th>
          <th>Vendor</th>
          <th>Hostname</th>
        </tr>
      </thead>
      <tbody>
        {data.map((h) => (
          <tr key={h.ip}>
            <td>{h.ip}</td>
            <td>{h.mac || '-'}</td>
            <td>{h.vendor || '-'}</td>
            <td>{h.hostname || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
