import type { InspectResult } from '../types/netscli';
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

export function InspectToolbar({
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
            { kind: 'inspect', host, ports: ports || undefined },
            async (op_id) => ({
              kind: 'inspect',
              data: await netscli.inspectHost(host, ports || undefined, op_id),
            }),
          );
        }}
      >
        {busy ? 'Cancel Scan' : 'Inspect Host'}
      </button>
    </div>
  );
}

export function InspectResults({ data }: { data: InspectResult }) {
  // Inspect renders the full structured result as pretty JSON. The
  // backend's InspectResult is a heterogeneous bag (host info + open
  // ports + DNS + ARP) so a single table doesn't fit; raw JSON keeps
  // every field visible without forcing the user into a tab tree.
  return (
    <div className="json-view">
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
