import { DEFAULT_PORTS } from '../registry';
import type { WorkspaceTab } from '../types';

export function buildCommand(tab: WorkspaceTab): string {
  const form = tab.form;
  switch (tab.kind) {
    case 'scan':
      return `netscli scan ${form.host || '<host>'} -p ${form.ports || DEFAULT_PORTS} --json`;
    case 'ping':
      return `netscli ping ${form.host || '<host>'}${form.count ? ` --count ${form.count}` : ''} --json`;
    case 'trace': {
      const resolve = form.resolve === 'On' ? ' --resolve' : '';
      return `netscli trace ${form.host || '<host>'}${form.max_hops ? ` --max-hops ${form.max_hops}` : ''}${resolve} --json`;
    }
    case 'discover':
      return `netscli discover${form.subnet ? ` ${form.subnet}` : ''} --resolve --json`;
    case 'dns': {
      const record = form.record && form.record !== 'ALL' ? ` --record ${form.record}` : '';
      return `netscli dns ${form.host || '<host>'}${record} --json`;
    }
    case 'reverse':
      return `netscli reverse ${form.ip || '<ip>'} --json`;
    case 'inspect':
      return `netscli inspect ${form.host || '<host>'}${form.ports ? ` -p ${form.ports}` : ''} --json`;
    case 'sweep':
      return `netscli sweep${form.subnet ? ` ${form.subnet}` : ''}${form.ports ? ` -p ${form.ports}` : ''} --resolve --json`;
    case 'mdns': {
      const types = form.service_types
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => ` --type ${item}`)
        .join('') ?? '';
      const timeout = form.timeout_ms && form.timeout_ms !== '3000' ? ` --timeout-ms ${form.timeout_ms}` : '';
      return `netscli mdns${timeout}${types} --json`;
    }
    case 'interfaces':
      return 'netscli interfaces --json';
    case 'arp':
      return 'netscli arp --json';
    case 'pcap': {
      if (form.mode === 'Open File') {
        return `netscli pcap --read <file>${form.max_packets ? ` --max-packets ${form.max_packets}` : ''} --json`;
      }
      const parts = ['netscli pcap'];
      if (form.interface) parts.push(`--interface ${form.interface}`);
      if (form.duration) parts.push(`--duration ${form.duration}`);
      if (form.filter) parts.push(`--filter "${form.filter}"`);
      if (form.max_packets) parts.push(`--max-packets ${form.max_packets}`);
      return parts.join(' ');
    }
  }
}
