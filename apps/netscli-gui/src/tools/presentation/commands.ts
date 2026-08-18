import type { WorkspaceTab } from '../types';

export function buildCommand(tab: WorkspaceTab): string {
  const form = tab.form;
  switch (tab.kind) {
    case 'scan':
      // `-p` is omitted when the field is empty, exactly as `inspect` and
      // `sweep` below already do. It used to substitute the GUI's
      // DEFAULT_PORTS placeholder (22,80,443,8080,8443) while execution sent
      // no port list at all and the core fell back to its own default of
      // 22,80,443 — so the preview claimed five ports, three were scanned,
      // and that wrong string was what Ctrl+Shift+C copied, what the History
      // menu recorded, and what got stored with the saved result.
      return `netscli scan ${form.host || '<host>'}${form.ports ? ` -p ${form.ports}` : ''} --json`;
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
      // Escape quotes rather than interpolating raw: a BPF filter containing
      // a double quote produced a preview that would not parse if pasted.
      if (form.filter) parts.push(`--filter "${form.filter.replace(/"/g, '\\"')}"`);
      if (form.max_packets) parts.push(`--max-packets ${form.max_packets}`);
      // The capture branch omitted --json while every other command here
      // includes it, so this one preview did not match what the app runs.
      parts.push('--json');
      return parts.join(' ');
    }
  }
}
