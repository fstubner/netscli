use anyhow::{Context, Result};
use hickory_resolver::proto::rr::RecordType;
use hickory_resolver::TokioAsyncResolver;
use serde::Serialize;
use std::net::IpAddr;
use std::sync::OnceLock;
use std::time::Duration;
#[cfg(windows)]
use std::{process::Stdio, str::FromStr};
#[cfg(windows)]
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Serialize)]
pub struct DnsRecord {
    /// Record type (e.g. "A", "AAAA", "MX"). Always upper-case.
    pub record_type: String,
    /// Display-normalized value. For textual records we strip surrounding
    /// quotes and the trailing `.` that the resolver appends to FQDNs.
    pub value: String,
}

const ALL_RECORD_TYPES: &[RecordType] = &[
    RecordType::A,
    RecordType::AAAA,
    RecordType::CNAME,
    RecordType::MX,
    RecordType::NS,
    RecordType::TXT,
    RecordType::SRV,
    RecordType::PTR,
    RecordType::SOA,
    RecordType::CAA,
];

pub fn parse_record_type(value: &str) -> Option<RecordType> {
    match value.trim().to_uppercase().as_str() {
        "A" => Some(RecordType::A),
        "AAAA" => Some(RecordType::AAAA),
        "CNAME" => Some(RecordType::CNAME),
        "MX" => Some(RecordType::MX),
        "NS" => Some(RecordType::NS),
        "TXT" => Some(RecordType::TXT),
        "SRV" => Some(RecordType::SRV),
        "PTR" => Some(RecordType::PTR),
        "SOA" => Some(RecordType::SOA),
        "CAA" => Some(RecordType::CAA),
        _ => None,
    }
}

/// Shared resolver — parsing the system config (`/etc/resolv.conf` or the
/// Windows registry) on every lookup is wasteful for high-volume scans like
/// a /24 with reverse DNS enabled.
fn shared_resolver() -> Result<&'static TokioAsyncResolver> {
    static RESOLVER: OnceLock<std::result::Result<TokioAsyncResolver, String>> = OnceLock::new();
    let cached = RESOLVER
        .get_or_init(|| TokioAsyncResolver::tokio_from_system_conf().map_err(|e| e.to_string()));
    match cached {
        Ok(r) => Ok(r),
        Err(e) => Err(anyhow::anyhow!("failed to load DNS resolver config: {e}")),
    }
}

/// Normalize a raw `RData.to_string()` value for display.
///
/// The hickory resolver prints FQDNs with a trailing dot and wraps TXT values
/// in double quotes. Both are technically correct per the DNS wire format but
/// users expect `example.com` not `example.com.` and `v=spf1 -all` not
/// `"v=spf1 -all"`. We strip those for presentation.
fn normalize_value(raw: &str) -> String {
    let s = raw.trim();
    // TXT values come back as `"chunk1" "chunk2"`; join into one string.
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        let inner = &s[1..s.len() - 1];
        // Collapse `" "` interior separators from multi-chunk TXT records.
        return inner.replace("\" \"", "");
    }
    // Strip a trailing FQDN dot but keep a lone "." (root) untouched.
    if s.len() > 1 && s.ends_with('.') {
        s.trim_end_matches('.').to_string()
    } else {
        s.to_string()
    }
}

pub async fn lookup_record_timeout(
    host: &str,
    record_type: RecordType,
    timeout_ms: u64,
) -> Result<Vec<DnsRecord>> {
    let resolver = shared_resolver()?;
    let response = timeout(
        Duration::from_millis(timeout_ms),
        resolver.lookup(host, record_type),
    )
    .await
    .with_context(|| format!("DNS {record_type} lookup timed out after {timeout_ms}ms"))??;

    let mut records = Vec::new();
    for record in response.record_iter() {
        let Some(data) = record.data() else {
            continue;
        };
        records.push(DnsRecord {
            record_type: record_type.to_string(),
            value: normalize_value(&data.to_string()),
        });
    }
    Ok(records)
}

/// Look up every supported record type, returning a merged list.
///
/// Queries run sequentially. An earlier attempt to parallelize via
/// `join_all` produced surprising regressions on Windows — a single slow
/// record type (commonly CAA for many domains) would cause the whole
/// batch to surface its timeout error even when other types had already
/// returned results. The cached `shared_resolver()` keeps each
/// individual query fast by avoiding `resolv.conf`/registry reparsing,
/// so sequential iteration is not noticeably slower in practice and
/// yields reliable partial-result behavior.
///
/// Partial failures (some types timeout, others return results) yield
/// `Ok(records)` — only a total failure with zero records surfaces the
/// last error.
pub async fn lookup_all_records_timeout(host: &str, timeout_ms: u64) -> Result<Vec<DnsRecord>> {
    let mut records = Vec::new();
    let mut last_err: Option<anyhow::Error> = None;

    for record_type in ALL_RECORD_TYPES {
        match lookup_record_timeout(host, *record_type, timeout_ms).await {
            Ok(mut found) => records.append(&mut found),
            Err(e) => last_err = Some(e),
        }
    }

    if records.is_empty() {
        if let Some(err) = last_err {
            return Err(err);
        }
        anyhow::bail!("no DNS records found for {host}");
    }

    Ok(records)
}

pub async fn resolve_a(host: &str) -> Result<Vec<String>> {
    resolve_a_timeout(host, crate::DEFAULT_DNS_TIMEOUT_MS).await
}

pub async fn resolve_a_timeout(host: &str, timeout_ms: u64) -> Result<Vec<String>> {
    let resolver = shared_resolver()?;
    let response = timeout(
        Duration::from_millis(timeout_ms),
        resolver.ipv4_lookup(host),
    )
    .await
    .with_context(|| format!("DNS A lookup timed out after {timeout_ms}ms"))??;
    Ok(response.iter().map(|ip| ip.to_string()).collect())
}

pub async fn resolve_aaaa(host: &str) -> Result<Vec<String>> {
    resolve_aaaa_timeout(host, crate::DEFAULT_DNS_TIMEOUT_MS).await
}

pub async fn resolve_aaaa_timeout(host: &str, timeout_ms: u64) -> Result<Vec<String>> {
    let resolver = shared_resolver()?;
    let response = timeout(
        Duration::from_millis(timeout_ms),
        resolver.ipv6_lookup(host),
    )
    .await
    .with_context(|| format!("DNS AAAA lookup timed out after {timeout_ms}ms"))??;
    Ok(response.iter().map(|ip| ip.to_string()).collect())
}

pub async fn reverse_lookup_timeout(ip: IpAddr, timeout_ms: u64) -> Result<Option<String>> {
    let resolver = shared_resolver()?;
    let resp = timeout(
        Duration::from_millis(timeout_ms),
        resolver.reverse_lookup(ip),
    )
    .await
    .with_context(|| format!("DNS reverse lookup timed out after {timeout_ms}ms"))??;
    let name = resp.iter().next().map(|n| n.to_utf8());
    Ok(name.filter(|s| !s.is_empty()))
}

/// Reverse-resolve an IP address to a hostname.
///
/// - On Windows, `ping -a` often resolves names via LLMNR/NetBIOS even when
///   no PTR records exist.
/// - On other platforms, this falls back to a DNS PTR lookup.
///
/// Both paths run their result through `normalize_hostname` so callers get
/// consistent output regardless of the OS we're on.
pub async fn reverse_lookup_best_effort_timeout(ip: IpAddr, timeout_ms: u64) -> Option<String> {
    #[cfg(windows)]
    if let Some(name) = reverse_lookup_windows_ping(ip, timeout_ms).await {
        if let Some(normalized) = normalize_hostname(name) {
            return Some(normalized);
        }
    }

    reverse_lookup_timeout(ip, timeout_ms)
        .await
        .ok()
        .flatten()
        .and_then(normalize_hostname)
}

fn normalize_hostname(name: String) -> Option<String> {
    let name = name.trim().trim_end_matches('.').trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

#[cfg(windows)]
async fn reverse_lookup_windows_ping(ip: IpAddr, timeout_ms: u64) -> Option<String> {
    // Only IPv4 is supported by the ping parsing below.
    if !matches!(ip, IpAddr::V4(_)) {
        return None;
    }

    let ip_s = ip.to_string();
    let wait_ms = timeout_ms.saturating_add(250);
    let mut cmd = Command::new("ping");
    cmd.args(["-a", "-n", "1", "-w", &timeout_ms.to_string(), &ip_s])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = match timeout(Duration::from_millis(wait_ms), cmd.output()).await {
        Ok(Ok(out)) => out,
        _ => return None,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Only scan the first few lines — `ping -a` emits the hostname in its
    // opening "Pinging <name> [<ip>] ..." banner. Later reply lines (e.g.
    // "Reply from 192.168.1.5: bytes=32 ..." on some locales) can also
    // contain `[ip]` and would otherwise misparse as a hostname.
    for line in stdout.lines().take(4) {
        if !line.contains('[') || !line.contains(']') {
            continue;
        }
        let Some(before) = line.split('[').next() else {
            continue;
        };
        let before = before.trim();

        // Take the last whitespace token before the "[ip]" segment as the
        // candidate hostname. This is locale-tolerant: English "Pinging X [ip]",
        // Spanish "Haciendo ping a X [ip] con 32 ...", etc.
        let Some(candidate) = before.split_whitespace().last() else {
            continue;
        };
        let candidate = candidate.trim().trim_end_matches('.');
        if candidate.is_empty() {
            continue;
        }

        // If the "hostname" is actually just the IP literal, there was no
        // reverse-resolution — fall through to PTR lookup.
        if IpAddr::from_str(candidate).is_ok() {
            return None;
        }

        return Some(candidate.to_string());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_value_strips_trailing_dot() {
        assert_eq!(normalize_value("example.com."), "example.com");
    }

    #[test]
    fn normalize_value_preserves_root_dot() {
        assert_eq!(normalize_value("."), ".");
    }

    #[test]
    fn normalize_value_unwraps_txt_quotes() {
        assert_eq!(normalize_value(r#""v=spf1 -all""#), "v=spf1 -all");
    }

    #[test]
    fn normalize_value_joins_multichunk_txt() {
        assert_eq!(normalize_value(r#""chunk1" "chunk2""#), "chunk1chunk2");
    }

    #[test]
    fn normalize_value_untouched_for_plain_a() {
        assert_eq!(normalize_value("192.0.2.1"), "192.0.2.1");
    }

    #[test]
    fn normalize_hostname_drops_trailing_dot_and_ws() {
        assert_eq!(
            normalize_hostname("host.example.com.".to_string()),
            Some("host.example.com".to_string())
        );
        assert_eq!(
            normalize_hostname("  host.example.com  ".to_string()),
            Some("host.example.com".to_string())
        );
    }

    #[test]
    fn normalize_hostname_rejects_empty() {
        assert_eq!(normalize_hostname("".to_string()), None);
        assert_eq!(normalize_hostname(".".to_string()), None);
    }

    #[tokio::test]
    async fn test_resolve_a_localhost() {
        let result = resolve_a("localhost").await;
        assert!(result.is_ok());
        let ips = result.unwrap();
        assert!(!ips.is_empty());
        // localhost should resolve to 127.0.0.1
        assert!(ips.contains(&"127.0.0.1".to_string()));
    }

    // NOTE: Unit tests avoid network-dependent DNS behavior.
    // Network integration tests should be added separately (and marked as ignored).
}
