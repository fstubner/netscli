import { formatNumber } from './values';
import type { ToolResult } from '../../types/app';
import type { PortResult } from '../../types/netscli';
import type { ResultRow, ToolKind } from '../types';
import { inspectPorts, latencyOf, statusOf } from './ports';
import { parseTraceLine, type TraceHopRow } from './traceLine';

function portRow(port: PortResult, index: number, kind: ToolKind): ResultRow {
  const status = statusOf(port);
  const data = {
    port: port.port,
    proto: 'tcp',
    service: port.service ?? '',
    status,
    latency: latencyOf(port),
    banner: port.banner ?? port.error ?? '',
  };
  return {
    id: `${kind}-port-${port.port}-${index}`,
    kind,
    data,
    raw: port,
    port,
    searchText: Object.values(data).join(' ').toLowerCase(),
  };
}

export function buildRows(result: ToolResult | null): ResultRow[] {
  if (!result) return [];

  switch (result.kind) {
    case 'scan':
      return result.data.map((port, index) => portRow(port, index, 'scan'));
    case 'ping': {
      const loss = Number.isFinite(result.data.loss_pct) ? `${formatNumber(result.data.loss_pct)}%` : '';
      const data = {
        metric: 'summary',
        host: result.data.host,
        ip: result.data.ip,
        sent: result.data.sent,
        received: result.data.received,
        loss,
        avg: result.data.rtt_ms_avg == null ? '' : `${formatNumber(result.data.rtt_ms_avg)} ms`,
        range:
          result.data.rtt_ms_min == null || result.data.rtt_ms_max == null
            ? ''
            : `${result.data.rtt_ms_min}-${result.data.rtt_ms_max} ms`,
      };
      return [
        {
          id: `ping-${result.data.host}`,
          kind: 'ping',
          data,
          raw: result.data,
          searchText: Object.values(data).join(' ').toLowerCase(),
        },
      ];
    }
    case 'trace':
      return result.data.lines
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => parseTraceLine(line))
        .filter((hop): hop is TraceHopRow => hop !== null)
        .map((hop, index) => {
          const data = {
            hop: hop.hop,
            status: hop.status,
            best: hop.best,
            avg: hop.avg,
            worst: hop.worst,
            address: hop.address,
          };
          return {
            id: `trace-${hop.hop}-${index}`,
            kind: 'trace' as const,
            data,
            raw: { ...hop, tool: result.data.tool, exit_code: result.data.exit_code },
            searchText: Object.values(data).join(' ').toLowerCase(),
          };
        });
    case 'discover':
      return result.data.map((host, index) => {
        const data = {
          ip: host.ip,
          hostname: host.hostname ?? '',
          mac: host.mac ?? '',
          vendor: host.vendor ?? '',
          rtt: host.rtt_ms == null ? '' : `${host.rtt_ms} ms`,
          // Carried through, not dropped. The table said "Responded host"
          // for every row, including the ones that answered nothing.
          found_by: host.found_by ?? '',
          found: host.found_by === 'neighbor' ? 'neighbour table' : host.found_by ? 'probe reply' : '',
        };
        return {
          id: `discover-${host.ip}-${index}`,
          kind: 'discover',
          data,
          raw: host,
          searchText: Object.values(data).join(' ').toLowerCase(),
        };
      });
    case 'dns':
      return result.data.map((record, index) => {
        const data = {
          record_type: record.record_type,
          value: record.value,
          ttl: record.ttl_seconds == null ? '' : `${record.ttl_seconds}s`,
          resolver: record.resolver_source ?? '',
          name: record.name ?? '',
        };
        return {
          id: `dns-${index}`,
          kind: 'dns',
          data,
          raw: record,
          searchText: Object.values(data).join(' ').toLowerCase(),
        };
      });
    case 'reverse': {
      const data = {
        ip: result.data.ip,
        hostname: result.data.hostname ?? '',
      };
      return [
        {
          id: `reverse-${result.data.ip}`,
          kind: 'reverse',
          data,
          raw: result.data,
          searchText: Object.values(data).join(' ').toLowerCase(),
        },
      ];
    }
    case 'inspect': {
      const ports = inspectPorts(result.data);
      const rows = ports.map((port, index) => portRow(port, index, 'inspect'));
      if (rows.length > 0) return rows;
      const ping = result.data.ping;
      const data = {
        host: result.data.host,
        ip: result.data.ip ?? '',
        status: ping?.alive ? 'up' : 'down',
        latency: ping?.rtt_ms == null ? '' : `${ping.rtt_ms} ms`,
        hostname: result.data.hostname ?? '',
      };
      return [
        {
          id: `inspect-${result.data.host}`,
          kind: 'inspect',
          data,
          raw: result.data,
          searchText: Object.values(data).join(' ').toLowerCase(),
        },
      ];
    }
    case 'sweep':
      return result.data.map((entry, index) => {
        const openPorts = entry.open_ports.map((port) => port.port).join(',');
        const data = {
          ip: entry.host.ip,
          hostname: entry.host.hostname ?? '',
          mac: entry.host.mac ?? '',
          vendor: entry.host.vendor ?? '',
          rtt: entry.host.rtt_ms == null ? '' : `${entry.host.rtt_ms} ms`,
          open_ports: entry.open_ports.length,
          ports: openPorts,
        };
        return {
          id: `sweep-${entry.host.ip}-${index}`,
          kind: 'sweep',
          data,
          raw: entry,
          searchText: Object.values(data).join(' ').toLowerCase(),
        };
      });
    case 'mdns':
      return result.data.map((service, index) => {
        const data = {
          service_type: service.service_type,
          hostname: service.hostname,
          addresses: service.addresses.join(', '),
          port: service.port,
          name: service.full_name,
        };
        return {
          id: `mdns-${service.full_name}-${index}`,
          kind: 'mdns',
          data,
          raw: service,
          searchText: Object.values(data).join(' ').toLowerCase(),
        };
      });
    case 'interfaces':
      return result.data.map((iface, index) => {
        const data = {
          name: iface.name,
          ips: iface.ips.join(', '),
          mac: iface.mac ?? '',
          state: iface.is_up ? 'up' : 'down',
          app: '',
          kind: interfaceKind(iface.name, iface.is_loopback),
          loopback: iface.is_loopback ? 'yes' : '',
        };
        return {
          id: `iface-${iface.name}-${index}`,
          kind: 'interfaces',
          data,
          raw: iface,
          searchText: Object.values(data).join(' ').toLowerCase(),
        };
      });
    case 'arp':
      return result.data.map((entry, index) => {
        const data = {
          ip: entry.ip,
          mac: entry.mac,
          interface: entry.interface,
          vendor: entry.vendor ?? '',
        };
        return {
          id: `arp-${entry.ip}-${index}`,
          kind: 'arp',
          data,
          raw: entry,
          searchText: Object.values(data).join(' ').toLowerCase(),
        };
      });
    case 'pcap': {
      return result.data.packets.map((packet) => {
        const data = {
          no: packet.index,
          time: packet.timestamp,
          source: packet.source,
          destination: packet.destination,
          protocol: packet.protocol,
          length: packet.length,
          info: packet.info,
          ports: packet.source_port != null && packet.destination_port != null
            ? `${packet.source_port} -> ${packet.destination_port}`
            : '',
        };
        return {
          id: `pcap-${packet.index}`,
          kind: 'pcap',
          data,
          raw: packet,
          searchText: Object.values(data).join(' ').toLowerCase(),
        };
      });
    }
  }
}

function interfaceKind(name: string, isLoopback: boolean): string {
  if (isLoopback) return 'loopback';
  const lowered = name.toLowerCase();
  if (lowered.includes('vmware') || lowered.includes('virtual') || lowered.includes('vethernet')) {
    return 'virtual';
  }
  if (lowered.includes('tailscale') || lowered.includes('wireguard') || lowered.includes('vpn')) {
    return 'vpn';
  }
  return 'physical';
}
