import type { ToolResult } from '../types/app';
import type {
  DefaultInterfaceInfo,
  DnsRecord,
  Host,
  InspectResult,
  InterfaceInfo,
  MdnsService,
  NetworkStats,
  PortResult,
} from '../types/netscli';
import type { ToolKind, WorkspaceTab } from '../tools/types';
import { createTab } from '../tools/registry';

export function isDemoScreenshotMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('demo') === 'screenshot';
}

/** Which demo tab opens first: `?demo=screenshot&tab=inspect`. Store and
 *  website screenshots take one per tool, from the same fixed data. */
export function demoScreenshotTabKind(): ToolKind | null {
  if (typeof window === 'undefined') return null;
  return (new URLSearchParams(window.location.search).get('tab') as ToolKind | null) ?? null;
}

export const DEMO_INTERFACE: InterfaceInfo = {
  name: 'Lab Adapter',
  mac: '02:00:5E:10:00:14',
  ips: ['192.0.2.14/24'],
  is_up: true,
  is_loopback: false,
};

export const DEMO_DEFAULT_INTERFACE: DefaultInterfaceInfo = {
  name: DEMO_INTERFACE.name,
  ips: DEMO_INTERFACE.ips,
  is_up: DEMO_INTERFACE.is_up,
};

export const DEMO_NETWORK_STATS: NetworkStats = {
  upload_mbps: 0.01,
  download_mbps: 0.03,
  upload_active: true,
  download_active: true,
  available: true,
};

const DEMO_SCAN_PORTS: PortResult[] = [
  {
    port: 22,
    open: true,
    status: 'open',
    service: 'ssh',
    product: 'OpenSSH',
    version: '9.6p1',
    latency_ms: 3,
    banner: 'SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5',
    http: null,
    tls: null,
    raw: 'SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5',
    error: null,
  },
  {
    port: 80,
    open: true,
    status: 'open',
    service: 'http',
    product: 'nginx',
    version: '1.24.0',
    latency_ms: 4,
    banner: 'nginx/1.24.0 (Ubuntu)',
    http: {
      status_line: 'HTTP/1.1 200 OK',
      headers: [
        { name: 'server', value: 'nginx/1.24.0 (Ubuntu)' },
        { name: 'content-type', value: 'text/html' },
      ],
    },
    tls: null,
    raw: 'HTTP/1.1 200 OK',
    error: null,
  },
  {
    port: 443,
    open: true,
    status: 'open',
    service: 'https',
    product: 'Caddy',
    latency_ms: 7,
    banner: 'Caddy',
    http: {
      status_line: 'HTTP/2 200',
      headers: [
        { name: 'server', value: 'Caddy' },
        { name: 'strict-transport-security', value: 'max-age=31536000' },
      ],
    },
    tls: {
      protocol: 'TLSv1.3',
      cipher_suite: 'TLS_AES_256_GCM_SHA384',
      alpn: 'h2',
    },
    raw: 'HTTP/2 200',
    error: null,
  },
  {
    port: 8080,
    open: true,
    status: 'open',
    service: 'http-alt',
    product: 'Jetty',
    version: '12.0.16',
    latency_ms: 2,
    banner: 'Jetty(12.0.16)',
    http: {
      status_line: 'HTTP/1.1 200 OK',
      headers: [{ name: 'server', value: 'Jetty(12.0.16)' }],
    },
    tls: null,
    raw: 'HTTP/1.1 200 OK',
    error: null,
  },
  {
    port: 53,
    open: false,
    status: 'closed',
    service: 'domain',
    latency_ms: 1,
    banner: null,
    http: null,
    tls: null,
    raw: null,
    error: null,
  },
  {
    port: 3306,
    open: true,
    status: 'open',
    service: 'mysql',
    product: 'MySQL',
    version: '8.0.36',
    latency_ms: 5,
    banner: '8.0.36-0ubuntu0.24.04.1',
    http: null,
    tls: null,
    raw: '8.0.36-0ubuntu0.24.04.1',
    error: null,
  },
  {
    port: 5432,
    open: false,
    status: 'filtered',
    service: 'postgresql',
    latency_ms: null,
    banner: null,
    http: null,
    tls: null,
    raw: null,
    error: 'TCP connect timed out before application data could be read.',
  },
  {
    port: 8443,
    open: false,
    status: 'filtered',
    service: 'https-alt',
    latency_ms: null,
    banner: null,
    http: null,
    tls: null,
    raw: null,
    error: 'TCP connect timed out before application data could be read.',
  },
];

// A home network in the documentation range (192.0.2.0/24, RFC 5737), so no
// screenshot shows a real address.
const DEMO_HOSTS: Host[] = [
  { ip: '192.0.2.1', hostname: 'router.home', mac: 'F0:9F:C2:3A:10:01', vendor: 'Ubiquiti Inc', rtt_ms: 1, found_by: 'probe', hostname_source: 'reverse' },
  { ip: '192.0.2.14', hostname: 'workstation.home', mac: '02:00:5E:10:00:14', vendor: null, rtt_ms: 0, found_by: 'probe', hostname_source: 'reverse' },
  { ip: '192.0.2.20', hostname: 'nas.local', mac: '00:11:32:8C:4E:20', vendor: 'Synology Incorporated', rtt_ms: 2, found_by: 'probe', hostname_source: 'mdns' },
  { ip: '192.0.2.23', hostname: 'homeserver.home', mac: 'D8:3A:DD:41:7B:23', vendor: 'Raspberry Pi Trading Ltd', rtt_ms: 3, found_by: 'probe', hostname_source: 'reverse' },
  { ip: '192.0.2.31', hostname: 'printer.local', mac: '3C:2A:F4:5D:91:31', vendor: 'Brother Industries, LTD.', rtt_ms: 6, found_by: 'probe', hostname_source: 'mdns' },
  { ip: '192.0.2.42', hostname: 'living-room-tv.local', mac: '70:2A:D5:12:C4:42', vendor: 'Samsung Electronics Co.,Ltd', rtt_ms: 9, found_by: 'neighbor', hostname_source: 'mdns' },
  { ip: '192.0.2.57', hostname: 'macbook.local', mac: 'A4:83:E7:66:02:57', vendor: 'Apple, Inc.', rtt_ms: 4, found_by: 'probe', hostname_source: 'mdns' },
  { ip: '192.0.2.63', hostname: 'kitchen-speaker.local', mac: '48:A6:B8:0F:33:63', vendor: 'Sonos, Inc.', rtt_ms: 12, found_by: 'probe', hostname_source: 'mdns' },
  { ip: '192.0.2.88', hostname: 'thermostat.home', mac: '18:B4:30:9E:21:88', vendor: 'Nest Labs Inc.', rtt_ms: 15, found_by: 'neighbor', hostname_source: 'reverse' },
  { ip: '192.0.2.104', hostname: 'pixel-8.home', mac: '9C:5A:81:2B:77:04', vendor: 'Google, Inc.', rtt_ms: 21, found_by: 'probe', hostname_source: 'reverse' },
];

const DEMO_INSPECT: InspectResult = {
  host: 'homeserver.home',
  ip: '192.0.2.23',
  ping: { ip: '192.0.2.23', rtt_ms: 3, ttl: 64, alive: true, seq: 1, method: 'icmpv4' },
  ports: DEMO_SCAN_PORTS,
  open_ports: DEMO_SCAN_PORTS.filter((port) => port.open),
  hostname: 'homeserver.home',
  mac: 'D8:3A:DD:41:7B:23',
  vendor: 'Raspberry Pi Trading Ltd',
  os_hint: {
    family: 'Linux',
    detail: 'Ubuntu',
    evidence: [
      'ssh: OpenSSH banner names Ubuntu',
      'http: nginx Server header names Ubuntu',
      'mac: Raspberry Pi network card',
      'ttl: ping reply TTL 64 (Linux, macOS, BSD)',
    ],
  },
};

const DEMO_DNS: DnsRecord[] = [
  { name: 'example.com', record_type: 'A', value: '93.184.215.14', ttl_seconds: 3600 },
  { name: 'example.com', record_type: 'AAAA', value: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', ttl_seconds: 3600 },
  { name: 'example.com', record_type: 'MX', value: '0 .', ttl_seconds: 86400 },
  { name: 'example.com', record_type: 'NS', value: 'a.iana-servers.net.', ttl_seconds: 86400 },
  { name: 'example.com', record_type: 'NS', value: 'b.iana-servers.net.', ttl_seconds: 86400 },
  { name: 'example.com', record_type: 'TXT', value: 'v=spf1 -all', ttl_seconds: 86400 },
  { name: 'example.com', record_type: 'SOA', value: 'ns.icann.org. noc.dns.icann.org. 2024081401 7200 3600 1209600 3600', ttl_seconds: 3600 },
  { name: 'example.com', record_type: 'CAA', value: '0 issue "digicert.com"', ttl_seconds: 86400 },
];

const DEMO_MDNS: MdnsService[] = [
  { full_name: 'Brother HL-L2350DW._ipp._tcp.local.', hostname: 'printer.local.', service_type: '_ipp._tcp.local.', addresses: ['192.0.2.31'], port: 631, properties: { ty: 'Brother HL-L2350DW', rp: 'ipp/print' } },
  { full_name: 'Kitchen._sonos._tcp.local.', hostname: 'kitchen-speaker.local.', service_type: '_sonos._tcp.local.', addresses: ['192.0.2.63'], port: 1443, properties: { info: '/api/v1/players/local/info' } },
  { full_name: 'Living Room TV._googlecast._tcp.local.', hostname: 'living-room-tv.local.', service_type: '_googlecast._tcp.local.', addresses: ['192.0.2.42'], port: 8009, properties: { fn: 'Living Room TV', md: 'Chromecast' } },
  { full_name: 'nas._smb._tcp.local.', hostname: 'nas.local.', service_type: '_smb._tcp.local.', addresses: ['192.0.2.20'], port: 445, properties: {} },
  { full_name: 'nas._http._tcp.local.', hostname: 'nas.local.', service_type: '_http._tcp.local.', addresses: ['192.0.2.20'], port: 5000, properties: { path: '/' } },
  { full_name: 'MacBook._airplay._tcp.local.', hostname: 'macbook.local.', service_type: '_airplay._tcp.local.', addresses: ['192.0.2.57'], port: 7000, properties: { model: 'Mac15,6' } },
  { full_name: 'Home Assistant._home-assistant._tcp.local.', hostname: 'homeserver.local.', service_type: '_home-assistant._tcp.local.', addresses: ['192.0.2.23'], port: 8123, properties: { version: '2026.9.3' } },
];

/** A ready-made tab of `kind` showing `result`, with its first row selected. */
function demoTab(kind: ToolKind, form: Record<string, string>, result: ToolResult): WorkspaceTab {
  const tab = createTab(kind);
  return {
    ...tab,
    id: `demo-${kind}-tab`,
    form: { ...tab.form, ...form },
    result,
    selectedIndex: 0,
    selectedIndices: [0],
    selectionAnchor: 0,
  };
}

export function createDemoScreenshotTabs(): WorkspaceTab[] {
  return [
    demoTab('discover', { subnet: '192.0.2.0/24' }, { kind: 'discover', data: DEMO_HOSTS }),
    {
      ...demoTab('scan', { host: 'homeserver.home', ports: '22,53,80,443,3306,5432,8080,8443' }, {
        kind: 'scan',
        data: DEMO_SCAN_PORTS,
      }),
      detailTab: 'banner',
      sortKey: 'port',
      sortDir: 'asc',
    },
    demoTab('inspect', { host: 'homeserver.home', ports: '22,53,80,443,3306,5432,8080,8443' }, { kind: 'inspect', data: DEMO_INSPECT }),
    demoTab('dns', { host: 'example.com', record: 'ALL' }, { kind: 'dns', data: DEMO_DNS }),
    demoTab('mdns', {}, { kind: 'mdns', data: DEMO_MDNS }),
  ];
}
