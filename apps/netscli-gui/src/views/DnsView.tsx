import type { DnsRecord } from '../types/netscli';
import * as netscli from '../services/netscli';
import type { ToolParams, ToolResult } from '../types/app';

type DnsRecordType = 'A' | 'AAAA';

interface ToolbarProps {
  busy: boolean;
  host: string;
  setHost: (v: string) => void;
  dnsType: DnsRecordType;
  setDnsType: (v: DnsRecordType) => void;
  validationErrors: Record<string, string | null>;
  setValidationErrors: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  onRun: (params: ToolParams, exec: (op_id: string) => Promise<ToolResult>) => void;
  onCancel: () => void;
}

export function DnsToolbar({
  busy,
  host,
  setHost,
  dnsType,
  setDnsType,
  validationErrors,
  setValidationErrors,
  onRun,
  onCancel,
}: ToolbarProps) {
  return (
    <div className="config-form">
      <div className="config-field">
        <label className="config-label">
          Hostname <span className="required">*</span>
        </label>
        <input
          className={`config-input ${validationErrors.host ? 'input-error' : ''}`}
          value={host}
          onChange={(e) => {
            setHost(e.target.value);
            setValidationErrors((prev) => ({ ...prev, host: null }));
          }}
          placeholder="google.com"
        />
        {validationErrors.host && (
          <span className="validation-error">{validationErrors.host}</span>
        )}
      </div>
      <div className="config-field">
        <label className="config-label">Type</label>
        <select
          className="config-input"
          value={dnsType}
          onChange={(e) => setDnsType(e.target.value as DnsRecordType)}
        >
          <option value="A">A (IPv4)</option>
          <option value="AAAA">AAAA (IPv6)</option>
        </select>
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
            setValidationErrors((prev) => ({ ...prev, host: 'Hostname is required' }));
            return;
          }
          setValidationErrors((prev) => ({ ...prev, host: null }));
          onRun(
            { kind: 'dns', host, record: dnsType },
            async (op_id) => ({
              kind: 'dns',
              data: await netscli.dnsLookup(host, dnsType, op_id),
            }),
          );
        }}
      >
        {busy ? 'Cancel' : 'Resolve'}
      </button>
    </div>
  );
}

export function DnsResults({ data }: { data: DnsRecord[] }) {
  // Backend returns DnsRecord[] — one row per answer, with the type
  // and its normalized value. Render as a two-column table so users
  // can tell an A from an MX from a TXT at a glance.
  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">No results</div>
      </div>
    );
  }
  return (
    <table className="results-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {data.map((r, idx) => (
          <tr key={`${r.record_type}-${r.value}-${idx}`}>
            <td>{r.record_type}</td>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
