import type { ToolResult } from '../../types/app';
import type { PortResult } from '../../types/netscli';
import type { ResultRow, ToolKind } from '../types';
import { latencyOf, statusOf } from './ports';

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
    case 'discover':
      return result.data.map((host, index) => {
        const data = {
          ip: host.ip,
          hostname: host.hostname ?? '',
          mac: host.mac ?? '',
          vendor: host.vendor ?? '',
          rtt: host.rtt_ms == null ? '' : `${host.rtt_ms} ms`,
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
        const data = { record_type: record.record_type, value: record.value };
        return {
          id: `dns-${index}`,
          kind: 'dns',
          data,
          raw: record,
          searchText: Object.values(data).join(' ').toLowerCase(),
        };
      });
    case 'inspect': {
      const rows = result.data.open_ports.map((port, index) => portRow(port, index, 'inspect'));
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
          open_ports: entry.open_ports.length,
          ports: openPorts,
          mac: entry.host.mac ?? '',
          vendor: entry.host.vendor ?? '',
        };
        return {
          id: `sweep-${entry.host.ip}-${index}`,
          kind: 'sweep',
          data,
          raw: entry,
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
