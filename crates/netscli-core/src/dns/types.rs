use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DnsRecord {
    /// Record type (e.g. "A", "AAAA", "MX"). Always upper-case.
    pub record_type: String,
    /// Display-normalized value. For textual records we strip surrounding
    /// quotes and the trailing `.` that the resolver appends to FQDNs.
    pub value: String,
}
