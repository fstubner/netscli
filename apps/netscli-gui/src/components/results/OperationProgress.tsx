import type { WorkspaceTab } from '../../tools/types';

interface OperationProgressProps {
  tab: WorkspaceTab;
}

export function OperationProgress({ tab }: OperationProgressProps) {
  return (
    <section className="operation-progress" aria-label="Operation progress">
      <div className="operation-progress-copy">
        <span>{operationTitle(tab)}</span>
        <small>{operationDetail(tab)}</small>
      </div>
      <div className="operation-progress-bar" aria-hidden="true">
        <span />
      </div>
    </section>
  );
}

function operationTitle(tab: WorkspaceTab): string {
  switch (tab.kind) {
    case 'scan':
      return 'Scanning ports';
    case 'discover':
      return 'Discovering hosts';
    case 'dns':
      return 'Resolving DNS records';
    case 'inspect':
      return 'Inspecting host';
    case 'sweep':
      return 'Sweeping network';
    case 'interfaces':
      return 'Refreshing interfaces';
    case 'arp':
      return 'Reading ARP table';
    case 'pcap':
      return 'Capturing packets';
  }
}

function operationDetail(tab: WorkspaceTab): string {
  switch (tab.kind) {
    case 'scan':
      return `${tab.form.host || 'host'} across ${countList(tab.form.ports)} ports`;
    case 'discover':
      return `${tab.form.subnet || 'selected subnet'} with host discovery probes`;
    case 'dns':
      return `${tab.form.record || 'ALL'} records for ${tab.form.host || 'host'}`;
    case 'inspect':
      return `${tab.form.host || 'host'} with ${countList(tab.form.ports)} port probes`;
    case 'sweep':
      return `${tab.form.subnet || 'selected subnet'} across ${countList(tab.form.ports)} ports per host`;
    case 'interfaces':
      return 'Collecting local interface state and addresses';
    case 'arp':
      return 'Collecting local neighbor entries and vendor names';
    case 'pcap':
      return `${tab.form.interface || 'selected interface'}, up to ${tab.form.max_packets || '1000'} packets`;
  }
}

function countList(value: string | undefined): number {
  if (!value) return 0;
  return value.split(',').map((part) => part.trim()).filter(Boolean).length;
}
