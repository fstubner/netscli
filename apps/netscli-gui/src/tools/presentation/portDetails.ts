import type { PortResult } from '../../types/netscli';
import type { DetailLine } from './detailLine';
import { latencyOf } from './ports';

export function portBannerLines(port: PortResult, latency: string): DetailLine[] {
  return [
    {
      label: 'Banner',
      value: port.banner?.trim() || 'No plaintext banner captured',
      muted: !port.banner?.trim(),
    },
    {
      label: 'Reason',
      value: port.banner?.trim() ? 'Application data was captured during the banner probe.' : bannerReason(port),
      muted: !port.banner?.trim(),
    },
    { label: 'Service', value: port.service || inferredProtocolLabel(port) },
    { label: 'Latency', value: latency || latencyOf(port) },
    { label: 'Error', value: port.error || '-' },
  ];
}

export function portHeaderLines(port: PortResult): DetailLine[] {
  const headers = port.http?.headers ?? [];
  if (port.http?.status_line || headers.length > 0) {
    return [
      { label: 'Status', value: port.http?.status_line || '-' },
      ...headers.map((header) => ({ label: header.name, value: header.value })),
    ];
  }

  return [
    { label: 'Status', value: 'No HTTP response captured', muted: true },
    { label: 'Reason', value: httpReason(port), muted: true },
  ];
}

export function portTlsLines(port: PortResult): DetailLine[] {
  if (port.tls?.protocol || port.tls?.cipher_suite || port.tls?.alpn) {
    return [
      { label: 'Protocol', value: port.tls?.protocol || '-' },
      { label: 'Cipher', value: port.tls?.cipher_suite || '-' },
      { label: 'ALPN', value: port.tls?.alpn || 'Not negotiated', muted: !port.tls?.alpn },
    ];
  }

  return [
    { label: 'Protocol', value: 'No TLS handshake captured', muted: true },
    { label: 'Reason', value: tlsReason(port), muted: true },
  ];
}

export function portRawPreview(port: PortResult): string {
  return JSON.stringify(port, null, 2);
}

function bannerReason(port: PortResult): string {
  switch (port.status) {
    case 'open':
      return 'The TCP connection opened, but the service did not send plaintext before the probe timeout.';
    case 'closed':
      return 'The connection was refused, so there was no application session to probe.';
    case 'filtered':
      return 'The TCP connect attempt timed out before application data could be read.';
    case 'error':
      return port.error || 'The probe failed before banner capture completed.';
  }
}

export function httpReason(port: PortResult): string {
  if (port.status !== 'open') {
    return 'HTTP probing is skipped unless the TCP connection opens first.';
  }
  if (!isHttpLike(port)) {
    return 'This port/service is not HTTP-like, so an HTTP HEAD probe was not attempted.';
  }
  return 'The HTTP probe did not receive a status line or headers before its timeout.';
}

export function tlsReason(port: PortResult): string {
  if (port.status !== 'open') {
    return 'TLS probing is skipped unless the TCP connection opens first.';
  }
  if (!isTlsLike(port)) {
    return 'This port/service is not TLS-like, so a TLS handshake probe was not attempted.';
  }
  return 'The TLS handshake did not complete before the probe timeout.';
}

function isHttpLike(port: PortResult): boolean {
  const service = port.service?.toLowerCase() ?? '';
  return service.includes('http') || [80, 443, 8000, 8008, 8080, 8443, 8888].includes(port.port);
}

function isTlsLike(port: PortResult): boolean {
  const service = port.service?.toLowerCase() ?? '';
  return service.includes('https') || service.includes('tls') || service.includes('ssl') || [443, 8443].includes(port.port);
}

function inferredProtocolLabel(port: PortResult): string {
  if (isHttpLike(port)) return 'http-like';
  if (isTlsLike(port)) return 'tls-like';
  return 'tcp';
}

// Kept as a named re-export so the detail modules read naturally, but the
// logic lives in one place now (M-7).
export { latencyOf as latencyOfPort };

export function portStatusMeaning(port: PortResult): string {
  switch (port.status) {
    case 'open':
      return 'TCP connect succeeded.';
    case 'closed':
      return 'The host refused the connection.';
    case 'filtered':
      return 'The probe timed out or was blocked before connect.';
    case 'error':
      return port.error || 'The probe failed before classification completed.';
  }
}
