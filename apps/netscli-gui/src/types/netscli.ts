// TypeScript types mirroring netscli-core's serde output.
// Keep field names and optionality in sync with the Rust structs.

export interface Host {
  ip: string;
  hostname?: string | null;
  mac?: string | null;
  vendor?: string | null;
  rtt_ms?: number | null;
}

export type PortStatus = 'open' | 'closed' | 'filtered' | 'error';

export interface HttpHeader {
  name: string;
  value: string;
}

export interface HttpProbe {
  status_line?: string | null;
  headers: HttpHeader[];
}

export interface TlsProbe {
  protocol?: string | null;
  cipher_suite?: string | null;
  alpn?: string | null;
}

export interface PortResult {
  port: number;
  open: boolean;
  status: PortStatus;
  service?: string | null;
  latency_ms?: number | null;
  banner?: string | null;
  http?: HttpProbe | null;
  tls?: TlsProbe | null;
  raw?: string | null;
  error?: string | null;
}

export interface PingResult {
  ip: string;
  rtt_ms?: number | null;
  alive: boolean;
  seq: number;
  // Present when the ping failed; omitted otherwise (serde skip_serializing_if = "Option::is_none").
  error?: string;
  // "icmpv4" or "tcp-connect" depending on the probe backend chosen.
  method?: string;
}

export interface InspectResult {
  host: string;
  ip?: string | null;
  ping?: PingResult | null;
  /** All scanned ports, including closed/filtered/error states. Older backends may omit this. */
  ports?: PortResult[];
  open_ports: PortResult[];
  hostname?: string | null;
}

export interface SweepEntry {
  host: Host;
  open_ports: PortResult[];
}

/**
 * Rust `InterfaceInfo` (crates/netscli-core/src/arp.rs).
 * `ips` are CIDR strings (e.g. "192.168.1.5/24"), not bare addresses.
 */
export interface InterfaceInfo {
  name: string;
  /** MAC address string or null when unavailable (e.g. loopback). */
  mac?: string | null;
  /** CIDR-formatted addresses — strip the `/NN` suffix for display if needed. */
  ips: string[];
  is_up: boolean;
  is_loopback: boolean;
}

export interface ArpEntry {
  ip: string;
  mac: string;
  interface: string;
  vendor?: string | null;
}

export interface NetworkStats {
  upload_mbps: number;
  download_mbps: number;
  /** True briefly after the last byte-count increase on the selected interface. */
  upload_active: boolean;
  download_active: boolean;
  available: boolean;
}

export interface DefaultInterfaceInfo {
  name: string;
  /** CIDR-formatted addresses, same as `InterfaceInfo.ips`. */
  ips: string[];
  is_up: boolean;
}

/** Rust `std::time::Duration` serialized by serde defaults. */
export interface RustDuration {
  secs: number;
  nanos: number;
}

export interface PcapPacketSummary {
  index: number;
  timestamp: string;
  source: string;
  destination: string;
  protocol: string;
  length: number;
  captured_length: number;
  info: string;
  source_port?: number | null;
  destination_port?: number | null;
  tcp_flags?: string | null;
  icmp_type?: number | null;
  icmp_code?: number | null;
  arp_operation?: string | null;
  ethernet_source?: string | null;
  ethernet_destination?: string | null;
  hex_preview?: string | null;
}

export interface PcapCapability {
  available: boolean;
  interfaces: string[];
  message?: string | null;
}

export interface FileSavePreferences {
  ask_each_time: boolean;
  default_directory?: string | null;
}

export interface PcapResult {
  packets_captured: number;
  duration: RustDuration;
  file_path: string;
  packets: PcapPacketSummary[];
  packets_truncated: boolean;
}

export interface DnsRecord {
  value: string;
  record_type: string;
  name?: string | null;
  ttl_seconds?: number | null;
  resolver_source?: string | null;
}
