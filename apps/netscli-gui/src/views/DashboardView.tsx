import type { HistoryEntry, ToolParams, ToolResult } from '../types/app';
import type { DefaultInterfaceInfo, InterfaceInfo, NetworkStats } from '../types/netscli';

function formatParams(params: ToolParams): string {
  switch (params.kind) {
    case 'discover':
      return params.subnet ? `Subnet: ${params.subnet}` : 'Auto-detect subnet';
    case 'scan':
      return `${params.host}${params.ports ? ` · Ports: ${params.ports}` : ''}`;
    case 'inspect':
      return `${params.host}${params.ports ? ` · Ports: ${params.ports}` : ''}`;
    case 'sweep':
      return `${params.subnet ?? 'Auto-detect'}${params.ports ? ` · Ports: ${params.ports}` : ''}`;
    case 'dns':
      return `${params.host} (${params.record})`;
    case 'interfaces':
      return 'List interfaces';
    case 'arp':
      return 'ARP table';
    case 'pcap':
      return `${params.interface} · ${params.duration ?? 5}s`;
  }
}

function getResultSummary(result: ToolResult): string {
  switch (result.kind) {
    case 'discover':
      return `${result.data.length} host${result.data.length !== 1 ? 's' : ''} found`;
    case 'scan': {
      const open = result.data.filter((p) => p.open).length;
      return `${open} open / ${result.data.length} scanned`;
    }
    case 'inspect':
      return 'Inspection complete';
    case 'sweep':
      return `${result.data.length} host${result.data.length !== 1 ? 's' : ''} with open ports`;
    case 'dns':
      return `${result.data.length} record${result.data.length !== 1 ? 's' : ''}`;
    case 'interfaces':
      return `${result.data.length} interface${result.data.length !== 1 ? 's' : ''}`;
    case 'arp':
      return `${result.data.length} entr${result.data.length !== 1 ? 'ies' : 'y'}`;
    case 'pcap':
      return `${result.data.packets_captured ?? 0} packets captured`;
  }
}

/** Pick the best IP to display: prefer IPv4 over long IPv6. */
function displayIp(ips: string[]): string {
  if (!ips || ips.length === 0) return 'N/A';
  const ipv4 = ips.find((ip) => !ip.includes(':'));
  if (ipv4) return ipv4;
  // Truncate long IPv6 for display
  const ip = ips[0];
  if (ip.length > 25) return ip.slice(0, 22) + '…';
  return ip;
}

export function DashboardView(props: {
  defaultInterface: DefaultInterfaceInfo | null;
  networkStats: NetworkStats | null;
  allInterfaces: InterfaceInfo[];
  scanHistory: HistoryEntry[];
  onSelectHistory: (entry: HistoryEntry) => void;
}) {
  const { defaultInterface, networkStats, allInterfaces, scanHistory, onSelectHistory } = props;

  return (
    <div className="dashboard">
      <h1 className="dashboard-page-title">Dashboard</h1>
      <div className="dashboard-grid">
        <div className="dashboard-card">
          <h3>Default Interface</h3>
          {defaultInterface ? (
            <div>
              <div className="dashboard-stat">
                <span className="stat-label">Name:</span>
                <span className="stat-value">{defaultInterface.name}</span>
              </div>
              <div className="dashboard-stat">
                <span className="stat-label">IP Address:</span>
                <span className="stat-value stat-value-ip" title={defaultInterface.ips[0] || ''}>
                  {displayIp(defaultInterface.ips)}
                </span>
              </div>
            </div>
          ) : (
            <div className="dashboard-empty">No interface data</div>
          )}
        </div>

        <div className="dashboard-card">
          <h3>Network Traffic</h3>
          {networkStats ? (
            <div>
              <div className="dashboard-stat">
                <span className="stat-label">Download:</span>
                <span className="stat-value">{networkStats.download_mbps.toFixed(2)} Mbps</span>
              </div>
              <div className="dashboard-stat">
                <span className="stat-label">Upload:</span>
                <span className="stat-value">{networkStats.upload_mbps.toFixed(2)} Mbps</span>
              </div>
            </div>
          ) : (
            <div className="dashboard-empty">No stats available</div>
          )}
        </div>

        <div className="dashboard-card">
          <h3>Network Interfaces</h3>
          {allInterfaces.length > 0 ? (
            <div className="dashboard-list">
              {allInterfaces
                .filter((i) => !i.is_loopback)
                .slice(0, 5)
                .map((iface) => (
                  <div key={iface.name} className="dashboard-list-item">
                    <span className="list-item-name">{iface.name}</span>
                    <span className={`list-item-status ${iface.is_up ? 'up' : 'down'}`}>
                      {iface.is_up ? 'UP' : 'DOWN'}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <div className="dashboard-empty">No interfaces found</div>
          )}
        </div>

        {scanHistory.length > 0 && (
          <div className="dashboard-card dashboard-card-full">
            <h3>Recent Scans</h3>
            <ul className="history-list" role="list">
              {scanHistory.slice(0, 10).map((entry) => (
                <li key={entry.id}>
                  {/*
                    Use a real <button> so keyboard users (Tab + Enter/Space)
                    can select history entries. Previously this was a <div>
                    with only onClick — inaccessible to anyone not using a
                    pointing device.
                  */}
                  <button
                    type="button"
                    className="history-item"
                    onClick={() => onSelectHistory(entry)}
                  >
                    <div className="history-item-header">
                      <span className="history-item-type">{entry.tab}</span>
                      <span className="history-item-time">
                        {entry.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="history-item-details">
                      <span className="history-item-params">{formatParams(entry.params)}</span>
                      <span className="history-item-result-count">
                        {getResultSummary(entry.result)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
