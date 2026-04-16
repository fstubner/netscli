// TypeScript types mirroring netscli-core's serde output.
// Keep field names and optionality in sync with the Rust structs.

export interface Host {
  ip: string;
  hostname?: string | null;
  mac?: string | null;
  vendor?: string | null;
  rtt_ms?: number | null;
}

export interface PortResult {
  port: number;
  open: boolean;
  service?: string | null;
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
  /** True for ~200ms after the last byte-count increase on the selected interface. */
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

export interface PcapResult {
  packets_captured: number;
  duration: RustDuration;
  file_path: string;
}

export interface DnsRecord {
  value: string;
  record_type: string;
}
