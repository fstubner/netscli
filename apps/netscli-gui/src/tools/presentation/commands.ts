import { DEFAULT_PORTS } from '../registry';
import type { WorkspaceTab } from '../types';

export function buildCommand(tab: WorkspaceTab): string {
  const form = tab.form;
  switch (tab.kind) {
    case 'scan':
      return `netscli scan ${form.host || '<host>'} -p ${form.ports || DEFAULT_PORTS} --json`;
    case 'discover':
      return `netscli discover${form.subnet ? ` ${form.subnet}` : ''} --resolve --json`;
    case 'dns': {
      const record = form.record && form.record !== 'ALL' ? ` --record ${form.record}` : '';
      return `netscli dns ${form.host || '<host>'}${record} --json`;
    }
    case 'inspect':
      return `netscli inspect ${form.host || '<host>'}${form.ports ? ` -p ${form.ports}` : ''} --json`;
    case 'sweep':
      return `netscli sweep${form.subnet ? ` ${form.subnet}` : ''}${form.ports ? ` -p ${form.ports}` : ''} --resolve --json`;
    case 'interfaces':
      return 'netscli interfaces --json';
    case 'arp':
      return 'netscli arp --json';
    case 'pcap': {
      const parts = ['netscli pcap'];
      if (form.interface) parts.push(`--interface ${form.interface}`);
      if (form.duration) parts.push(`--duration ${form.duration}`);
      if (form.filter) parts.push(`--filter "${form.filter}"`);
      if (form.max_packets) parts.push(`--max-packets ${form.max_packets}`);
      return parts.join(' ');
    }
  }
}
