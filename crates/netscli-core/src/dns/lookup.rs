use hickory_resolver::lookup::Lookup;
use hickory_resolver::proto::rr::{RData, RecordType};
use std::time::Duration;
use tokio::time::timeout;

use super::records::{normalize_value, ALL_RECORD_TYPES};
use super::resolver::{fallback_resolver, shared_resolver};
use super::types::DnsRecord;
use crate::error::{Error, Result};

pub async fn lookup_record_timeout(
    host: &str,
    record_type: RecordType,
    timeout_ms: u64,
) -> Result<Vec<DnsRecord>> {
    let (response, resolver_source) = lookup_with_fallback(host, record_type, timeout_ms).await?;

    // hickory 0.26 dropped `Lookup::record_iter()` in favor of explicit
    // `.answers()` / `.authorities()` / `.additionals()` slice accessors.
    // We only ever care about answer records.
    // hickory 0.26 made `Record::data` a public field instead of a method,
    // and dropped the previous Option wrapper around RData. Accessor is
    // now plain `record.data`.
    let mut records = Vec::new();
    for record in response.answers() {
        records.push(DnsRecord {
            record_type: record_type.to_string(),
            value: normalize_value(&record.data.to_string()),
            name: Some(normalize_value(&record.name.to_string())),
            ttl_seconds: Some(record.ttl),
            resolver_source: Some(resolver_source.to_string()),
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
    let mut last_err: Option<Error> = None;

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
        return Err(Error::dns(format!("no DNS records found for {host}")));
    }

    Ok(records)
}

pub async fn resolve_a(host: &str) -> Result<Vec<String>> {
    resolve_a_timeout(host, crate::DEFAULT_DNS_TIMEOUT_MS).await
}

pub async fn resolve_a_timeout(host: &str, timeout_ms: u64) -> Result<Vec<String>> {
    let (response, _) = lookup_with_fallback(host, RecordType::A, timeout_ms).await?;
    // hickory 0.26 returns the flat `Lookup` here (it used to be a typed
    // `Ipv4Lookup` wrapper that yielded `&Ipv4Addr` directly). We now
    // extract the IPv4 from each answer's RData::A variant.
    Ok(response
        .answers()
        .iter()
        .filter_map(|r| match &r.data {
            RData::A(a) => Some(a.to_string()),
            _ => None,
        })
        .collect())
}

pub async fn resolve_aaaa(host: &str) -> Result<Vec<String>> {
    resolve_aaaa_timeout(host, crate::DEFAULT_DNS_TIMEOUT_MS).await
}

pub async fn resolve_aaaa_timeout(host: &str, timeout_ms: u64) -> Result<Vec<String>> {
    let (response, _) = lookup_with_fallback(host, RecordType::AAAA, timeout_ms).await?;
    Ok(response
        .answers()
        .iter()
        .filter_map(|r| match &r.data {
            RData::AAAA(a) => Some(a.to_string()),
            _ => None,
        })
        .collect())
}

async fn lookup_with_fallback(
    host: &str,
    record_type: RecordType,
    timeout_ms: u64,
) -> Result<(Lookup, &'static str)> {
    let resolver = shared_resolver()?;
    match timeout(
        Duration::from_millis(timeout_ms),
        resolver.lookup(host, record_type),
    )
    .await
    {
        Ok(Ok(resp)) => Ok((resp, "system")),
        Ok(Err(system_err)) => {
            if !super::resolver::should_use_public_fallback(host) {
                return Err(Error::dns(format!(
                    "{record_type} lookup failed: system resolver returned {system_err}; public fallback disabled"
                )));
            }
            let fallback = fallback_resolver()?;
            match timeout(
                Duration::from_millis(timeout_ms),
                fallback.lookup(host, record_type),
            )
            .await
            {
                Ok(Ok(resp)) => Ok((resp, "public_fallback")),
                Ok(Err(fallback_err)) => Err(Error::dns(format!(
                    "{record_type} lookup failed: system resolver returned {system_err}; public fallback returned {fallback_err}"
                ))),
                Err(_) => Err(Error::dns(format!(
                    "{record_type} lookup failed: system resolver returned {system_err}; public fallback timed out after {timeout_ms}ms"
                ))),
            }
        }
        Err(_) => Err(Error::Timeout(timeout_ms)),
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_a;
    use crate::dns::DnsRecord;

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

    #[test]
    fn dns_record_serializes_additive_metadata() {
        let record = DnsRecord {
            record_type: "A".to_string(),
            value: "127.0.0.1".to_string(),
            name: Some("localhost".to_string()),
            ttl_seconds: Some(60),
            resolver_source: Some("system".to_string()),
        };

        let value = serde_json::to_value(record).expect("serialize DNS record");
        assert_eq!(value["name"], "localhost");
        assert_eq!(value["ttl_seconds"], 60);
        assert_eq!(value["resolver_source"], "system");
    }
}
