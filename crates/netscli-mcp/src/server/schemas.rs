use ipnet::Ipv4Net;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

use super::errors::RpcError;

const MAX_SUBNET_ADDRESSES: u64 = 1 << 16; // /16

pub(super) fn clamp_concurrency(max_concurrent: Option<usize>, default: usize) -> usize {
    let c = max_concurrent.unwrap_or(default);
    c.clamp(1, 4096)
}

pub(super) fn clamp_timeout_ms(timeout_ms: Option<u64>, default: u64) -> u64 {
    // Enforce a sane lower/upper bound to prevent hangs or instant timeouts.
    let t = timeout_ms.unwrap_or(default);
    t.clamp(10, 10 * 60 * 1000)
}

pub(super) fn parse_params<T: DeserializeOwned>(val: Value) -> Result<T, RpcError> {
    serde_json::from_value(val).map_err(|e| RpcError::InvalidParams(e.to_string()))
}

pub(super) fn validate_subnet(subnet: &str) -> Result<(), RpcError> {
    let net: Ipv4Net = subnet
        .parse()
        .map_err(|e| RpcError::InvalidParams(format!("invalid subnet '{subnet}': {e}")))?;
    let prefix = net.prefix_len() as u32;
    let total = 1u64
        .checked_shl(32u32.saturating_sub(prefix))
        .unwrap_or(u64::MAX);
    if total > MAX_SUBNET_ADDRESSES {
        return Err(RpcError::InvalidParams(format!(
            "subnet too large: {subnet} (max /16)"
        )));
    }
    Ok(())
}

pub(super) fn normalize_ports(mut ports: Option<Vec<u16>>) -> Result<Option<Vec<u16>>, RpcError> {
    let Some(mut ps) = ports.take() else {
        return Ok(None);
    };
    if ps.is_empty() {
        return Ok(None);
    }
    if ps.len() > netscli_core::MAX_PORTS_PER_SCAN {
        return Err(RpcError::InvalidParams(format!(
            "too many ports requested ({} > {})",
            ps.len(),
            netscli_core::MAX_PORTS_PER_SCAN
        )));
    }
    if ps.contains(&0) {
        return Err(RpcError::InvalidParams("port 0 is invalid".to_string()));
    }
    ps.sort_unstable();
    ps.dedup();
    Ok(Some(ps))
}

#[derive(Deserialize)]
pub(super) struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    pub(super) protocol_version: Option<String>,
    #[allow(dead_code)]
    pub(super) capabilities: Option<serde_json::Value>,
    #[allow(dead_code)]
    #[serde(rename = "clientInfo")]
    pub(super) client_info: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub(super) struct DiscoverParams {
    pub(super) subnet: Option<String>,
    #[serde(rename = "resolveHostnames")]
    pub(super) resolve_hostnames: Option<bool>,
    pub(super) timeout: Option<u64>,
    #[serde(rename = "maxConcurrent")]
    pub(super) max_concurrent: Option<usize>,
}

#[derive(Deserialize)]
pub(super) struct PingHostParams {
    pub(super) host: String,
    /// Number of ICMP/TCP probes to send. Defaults to 1 (single-shot); the
    /// CLI's `netscli ping` defaults to 4 but MCP clients typically want a
    /// single summary for a scripted workflow.
    #[serde(default)]
    pub(super) count: Option<u32>,
    pub(super) timeout: Option<u64>,
    #[serde(rename = "maxConcurrent")]
    pub(super) max_concurrent: Option<usize>,
}

#[derive(Deserialize)]
pub(super) struct ScanParams {
    pub(super) host: String,
    pub(super) ports: Option<Vec<u16>>,
    pub(super) timeout: Option<u64>,
    #[serde(rename = "maxConcurrent")]
    pub(super) max_concurrent: Option<usize>,
}

#[derive(Deserialize)]
pub(super) struct DnsParams {
    pub(super) host: String,
    #[serde(rename = "type")]
    pub(super) record_type: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct SweepParams {
    pub(super) subnet: Option<String>,
    pub(super) ports: Option<Vec<u16>>,
    #[serde(rename = "resolveHostnames")]
    pub(super) resolve_hostnames: Option<bool>,
    pub(super) timeout: Option<u64>,
    #[serde(rename = "maxConcurrent")]
    pub(super) max_concurrent: Option<usize>,
}

#[derive(Deserialize)]
#[cfg_attr(not(feature = "pcap"), allow(dead_code))]
pub(super) struct PcapParams {
    pub(super) interface: String,
    pub(super) filter: Option<String>,
    pub(super) duration: Option<u64>,
    #[serde(rename = "outputFile")]
    pub(super) output_file: Option<String>,
    #[serde(rename = "maxPackets")]
    pub(super) max_packets: Option<u64>,
}

#[derive(Deserialize)]
#[cfg_attr(not(feature = "pcap"), allow(dead_code))]
pub(super) struct PcapJobParams {
    #[serde(rename = "jobId")]
    pub(super) job_id: String,
}

#[cfg(feature = "mdns")]
#[derive(Deserialize, Default)]
pub(super) struct MdnsParams {
    #[serde(default)]
    pub(super) timeout_ms: Option<u64>,
    #[serde(default)]
    pub(super) service_types: Option<Vec<String>>,
}
