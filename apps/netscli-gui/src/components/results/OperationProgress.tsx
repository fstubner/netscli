import type { WorkspaceTab } from '../../tools/types';

interface OperationProgressProps {
  tab: WorkspaceTab;
}

export function OperationProgress({ tab }: OperationProgressProps) {
  const progress = tab.progress;
  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : null;
  const detail = progress?.detail || operationDetail(tab);

  return (
    <section className="operation-progress" aria-label="Operation progress">
      <div className="operation-progress-copy">
        <span>{operationTitle(tab)}</span>
        <small>{detail}</small>
      </div>
      <div
        aria-valuemax={total || undefined}
        aria-valuemin={0}
        aria-valuenow={pct == null ? undefined : completed}
        aria-valuetext={pct == null ? detail : `${completed} of ${total}, ${pct}%`}
        className={`operation-progress-bar ${pct == null ? 'indeterminate' : 'determinate'}`}
        role="progressbar"
      >
        <span style={pct == null ? undefined : { transform: `scaleX(${pct / 100})` }} />
      </div>
    </section>
  );
}

function operationTitle(tab: WorkspaceTab): string {
  switch (tab.kind) {
    case 'scan':
      return 'Scanning ports';
    case 'ping':
      return 'Pinging host';
    case 'trace':
      return 'Tracing route';
    case 'discover':
      return 'Discovering hosts';
    case 'dns':
      return 'Resolving DNS records';
    case 'reverse':
      return 'Resolving reverse DNS';
    case 'inspect':
      return 'Inspecting host';
    case 'sweep':
      return 'Sweeping network';
    case 'mdns':
      return 'Discovering mDNS services';
    case 'interfaces':
      return 'Refreshing interfaces';
    case 'arp':
      return 'Reading ARP table';
    case 'pcap':
      return tab.form.mode === 'Open File' ? 'Opening packet capture' : 'Capturing packets';
  }
}

function operationDetail(tab: WorkspaceTab): string {
  switch (tab.kind) {
    case 'scan':
      return `${tab.form.host || 'host'} across ${countList(tab.form.ports)} ports`;
    case 'ping':
      return `${tab.form.host || 'host'} with ${tab.form.count || '4'} probes`;
    case 'trace':
      return `${tab.form.host || 'host'} up to ${tab.form.max_hops || '30'} hops`;
    case 'discover':
      return `${tab.form.subnet || 'selected subnet'} with host discovery probes`;
    case 'dns':
      return `${tab.form.record || 'ALL'} records for ${tab.form.host || 'host'}`;
    case 'reverse':
      return `Reverse lookup for ${tab.form.ip || 'IP address'}`;
    case 'inspect':
      return `${tab.form.host || 'host'} with ${countList(tab.form.ports)} port probes`;
    case 'sweep':
      return `${tab.form.subnet || 'selected subnet'} across ${countList(tab.form.ports)} ports per host`;
    case 'mdns':
      return tab.form.service_types?.trim()
        ? `Listening for ${tab.form.service_types}`
        : 'Listening for local service announcements';
    case 'interfaces':
      return 'Collecting local interface state and addresses';
    case 'arp':
      return 'Collecting local neighbor entries and vendor names';
    case 'pcap':
      return tab.form.mode === 'Open File'
        ? `Parsing up to ${tab.form.max_packets || '1000'} packets`
        : `${tab.form.interface || 'selected interface'}, up to ${tab.form.max_packets || '1000'} packets`;
  }
}

function countList(value: string | undefined): number {
  if (!value) return 0;
  return value.split(',').map((part) => part.trim()).filter(Boolean).length;
}
