import type { ArpEntry, InterfaceInfo } from '../types/netscli';
import * as netscli from '../services/netscli';
import type { ToolParams, ToolResult } from '../types/app';

interface ToolbarProps {
  busy: boolean;
  onRun: (params: ToolParams, exec: (op_id: string) => Promise<ToolResult>) => void;
  onCancel: () => void;
}

export function InterfacesToolbar({ busy, onRun, onCancel }: ToolbarProps) {
  // The interfaces tab supports two distinct read-only operations
  // sharing one tab (the list of network interfaces, and the kernel ARP
  // table). Keeping them on one tab matches the CLI surface; rendering
  // them as twin buttons mirrors that.
  return (
    <div className="config-form">
      <button
        className={`config-button ${busy ? 'cancel' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          if (busy) {
            onCancel();
          } else {
            onRun(
              { kind: 'interfaces' },
              async (op_id) => ({
                kind: 'interfaces',
                data: await netscli.listInterfaces(op_id),
              }),
            );
          }
        }}
      >
        {busy ? 'Cancel' : 'Refresh Interfaces'}
      </button>
      <button
        className={`config-button ${busy ? 'cancel' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          if (busy) {
            onCancel();
          } else {
            onRun(
              { kind: 'arp' },
              async (op_id) => ({ kind: 'arp', data: await netscli.getArpTable(op_id) }),
            );
          }
        }}
      >
        {busy ? 'Cancel' : 'Show ARP Table'}
      </button>
    </div>
  );
}

export function InterfacesResults({ data }: { data: InterfaceInfo[] }) {
  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">No interfaces found</div>
      </div>
    );
  }
  return (
    <table className="results-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>State</th>
          <th>MAC Address</th>
          <th>Addresses</th>
        </tr>
      </thead>
      <tbody>
        {data.map((iface) => (
          <tr key={iface.name}>
            <td>
              {iface.name}
              {iface.is_loopback && (
                <span className="row-badge row-badge-muted" title="Loopback interface">
                  loopback
                </span>
              )}
            </td>
            <td>
              <span
                className={`row-badge ${iface.is_up ? 'row-badge-up' : 'row-badge-down'}`}
              >
                {iface.is_up ? 'UP' : 'DOWN'}
              </span>
            </td>
            <td className="mono-cell">{iface.mac || '-'}</td>
            <td className="mono-cell">
              {iface.ips.length === 0 ? (
                <span className="dim">-</span>
              ) : (
                iface.ips.map((ip) => (
                  <div key={ip} className="ip-line">
                    {ip}
                  </div>
                ))
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ArpResults({ data }: { data: ArpEntry[] }) {
  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">No data</div>
      </div>
    );
  }
  return (
    <table className="results-table">
      <thead>
        <tr>
          <th>IP Address</th>
          <th>MAC Address</th>
          <th>Interface</th>
          <th>Vendor</th>
        </tr>
      </thead>
      <tbody>
        {data.map((e) => (
          <tr key={`${e.ip}-${e.mac}-${e.interface}`}>
            <td>{e.ip}</td>
            <td>{e.mac}</td>
            <td>{e.interface}</td>
            <td>{e.vendor || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
