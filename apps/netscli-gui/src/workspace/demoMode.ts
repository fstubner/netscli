import type { ToolResult } from '../types/app';
import type { DefaultInterfaceInfo, InterfaceInfo, NetworkStats, PortResult } from '../types/netscli';
import type { WorkspaceTab } from '../tools/types';
import { createTab } from '../tools/registry';

export function isDemoScreenshotMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('demo') === 'screenshot';
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
    latency_ms: 3,
    banner: 'SSH-2.0-OpenSSH_9.6',
    http: null,
    tls: null,
    raw: 'SSH-2.0-OpenSSH_9.6',
    error: null,
  },
  {
    port: 80,
    open: true,
    status: 'open',
    service: 'http',
    latency_ms: 4,
    banner: 'nginx',
    http: {
      status_line: 'HTTP/1.1 200 OK',
      headers: [
        { name: 'server', value: 'nginx' },
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
    latency_ms: 7,
    banner: 'caddy',
    http: {
      status_line: 'HTTP/2 200',
      headers: [
        { name: 'server', value: 'caddy' },
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
    latency_ms: 2,
    banner: 'netscli-demo',
    http: {
      status_line: 'HTTP/1.1 200 OK',
      headers: [{ name: 'x-demo-service', value: 'netscli' }],
    },
    tls: null,
    raw: 'netscli-demo',
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

export function createDemoScreenshotTabs(): WorkspaceTab[] {
  const scan = createTab('scan');
  const result: ToolResult = { kind: 'scan', data: DEMO_SCAN_PORTS };

  return [
    {
      ...scan,
      id: 'demo-scan-tab',
      title: 'scan',
      form: {
        host: 'demo.local',
        ports: '22,53,80,443,3306,5432,8080,8443',
      },
      result,
      selectedIndex: 0,
      selectedIndices: [0],
      selectionAnchor: 0,
      detailTab: 'banner',
      sortKey: 'port',
      sortDir: 'asc',
    },
  ];
}
