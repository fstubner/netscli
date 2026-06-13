import type { ToolResult } from '../../types/app';

export function resultSummary(result: ToolResult | null): string {
  if (!result) return '0 results';
  switch (result.kind) {
    case 'scan': {
      const open = result.data.filter((port) => port.open).length;
      return `${result.data.length} results - ${open} open`;
    }
    case 'ping':
      return `${result.data.received}/${result.data.sent} replies - ${formatNumber(result.data.loss_pct)}% loss`;
    case 'trace':
      return `${traceHopCount(result.data.lines)} hops - ${result.data.tool}`;
    case 'discover':
      return `${result.data.length} hosts`;
    case 'dns':
      return `${result.data.length} records`;
    case 'reverse':
      return result.data.hostname ? 'reverse name found' : 'no reverse name';
    case 'inspect': {
      const ports = result.data.ports ?? result.data.open_ports;
      if (ports.length > 0) {
        const open = ports.filter((port) => port.open).length;
        return `${ports.length} ${ports.length === 1 ? 'port' : 'ports'} checked - ${open} open`;
      }
      if (result.data.ping) return `${result.data.ping.alive ? 'host up' : 'host down'} - 0 open ports`;
      return '0 open ports';
    }
    case 'sweep': {
      const hosts = result.data.length;
      const open = result.data.filter((host) => host.open_ports.length > 0).length;
      return `${hosts} hosts - ${open} with open ports`;
    }
    case 'mdns':
      return `${result.data.length} services`;
    case 'interfaces':
      return `${result.data.length} interfaces`;
    case 'arp':
      return `${result.data.length} ARP entries`;
    case 'pcap':
      return `${'packets_captured' in result.data ? result.data.packets_captured : result.data.total_packets} packets`;
  }
}

function traceHopCount(lines: string[]): number {
  return lines.filter((line) => /^\s*\d+\s+/.test(line)).length;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
