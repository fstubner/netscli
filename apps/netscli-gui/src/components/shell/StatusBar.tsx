import { ArrowDown, ArrowUp } from 'lucide-react';

import type { DefaultInterfaceInfo, NetworkStats } from '../../types/netscli';
import { resultSummary } from '../../tools/presentation';
import { TOOL_CONFIG } from '../../tools/registry';
import type { WorkspaceTab } from '../../tools/types';

interface StatusBarProps {
  activeTab: WorkspaceTab | undefined;
  interfaceInfo: DefaultInterfaceInfo | null;
  animateTrafficArrows: boolean;
  networkStats: NetworkStats | null;
  rowCount: number;
  selectedCount: number;
}

export function StatusBar({
  activeTab,
  interfaceInfo,
  animateTrafficArrows,
  networkStats,
  rowCount,
  selectedCount,
}: StatusBarProps) {
  const interfaceDown = Boolean(interfaceInfo && !interfaceInfo.is_up);
  const statusText = interfaceInfo ? (interfaceDown ? 'Interface down' : 'Interface up') : 'No interface';
  const resultText = activeTab ? footerResultText(activeTab, rowCount, selectedCount) : null;
  const operationText = activeTab?.busy ? `Running ${TOOL_CONFIG[activeTab.kind].label}` : null;

  return (
    <footer className="statusbar" data-testid="statusbar">
      <div className="status-left">
        <span className={`run-dot ${interfaceDown ? 'down' : ''}`} />
        <span>{statusText}</span>
        {interfaceInfo && (
          <>
            <span className="divider" />
            <span>{interfaceInfo.name}</span>
            <code>{interfaceInfo.ips[0] ?? 'no address'}</code>
          </>
        )}
        {networkStats && (
          <>
            <span className="divider" />
            <TrafficStats animateArrows={animateTrafficArrows} stats={networkStats} />
          </>
        )}
        {operationText && (
          <>
            <span className="divider" />
            <span className="operation-status">{operationText}</span>
          </>
        )}
      </div>
      {resultText && <div className="status-right">{resultText}</div>}
    </footer>
  );
}

function footerResultText(tab: WorkspaceTab, rowCount: number, selectedCount: number): string {
  if (selectedCount > 1 && rowCount > 0) return `${selectedCount} of ${rowCount} selected`;
  return resultSummary(tab.result ?? null);
}

function TrafficStats({ animateArrows, stats }: { animateArrows: boolean; stats: NetworkStats }) {
  const downloadActive = animateArrows && stats.download_active;
  const uploadActive = animateArrows && stats.upload_active;
  const title = stats.available ? 'Network activity on selected interface' : 'No traffic data for selected interface';

  return (
    <span className="traffic-stats" data-testid="traffic-stats" aria-label={title} data-tooltip={title}>
      <span
        className={`traffic-rate ${downloadActive ? 'active' : ''}`}
        data-testid="traffic-download"
        aria-label="download"
        data-active={downloadActive ? 'true' : 'false'}
      >
        <span className="traffic-arrow">
          <ArrowDown size={12} />
        </span>
        <span>{stats.download_mbps.toFixed(2)}</span>
      </span>
      <span
        className={`traffic-rate ${uploadActive ? 'active' : ''}`}
        data-testid="traffic-upload"
        aria-label="upload"
        data-active={uploadActive ? 'true' : 'false'}
      >
        <span className="traffic-arrow">
          <ArrowUp size={12} />
        </span>
        <span>{stats.upload_mbps.toFixed(2)}</span>
      </span>
      <span className="traffic-unit">Mbps</span>
    </span>
  );
}
