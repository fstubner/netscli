use serde::Serialize;

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct DnsRecord {
    /// Record type (e.g. "A", "AAAA", "MX"). Always upper-case.
    pub record_type: String,
    /// Display-normalized value. For textual records we strip surrounding
    /// quotes and the trailing `.` that the resolver appends to FQDNs.
    pub value: String,
    /// Owner name returned by the resolver, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub name: Option<String>,
    /// Record TTL in seconds, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub ttl_seconds: Option<u32>,
    /// Resolver path used for this answer, for example "system" or
    /// "public_fallback".
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub resolver_source: Option<String>,
}
