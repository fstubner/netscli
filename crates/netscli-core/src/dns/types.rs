use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DnsRecord {
    /// Record type (e.g. "A", "AAAA", "MX"). Always upper-case.
    pub record_type: String,
    /// Display-normalized value. For textual records we strip surrounding
    /// quotes and the trailing `.` that the resolver appends to FQDNs.
    pub value: String,
    /// Owner name returned by the resolver, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Record TTL in seconds, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<u32>,
    /// Resolver path used for this answer, for example "system" or
    /// "public_fallback".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolver_source: Option<String>,
}
