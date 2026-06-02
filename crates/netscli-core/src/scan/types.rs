use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PortStatus {
    Open,
    Closed,
    Filtered,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpProbe {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_line: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<HttpHeader>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TlsProbe {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cipher_suite: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alpn: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortResult {
    pub port: u16,
    pub open: bool,
    pub status: PortStatus,
    pub service: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http: Option<HttpProbe>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls: Option<TlsProbe>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    /// Populated when the probe failed for reasons other than a closed port
    /// (e.g. the scanner's concurrency semaphore was closed). Omitted on
    /// normal open/closed results.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl PortResult {
    pub(super) fn new(port: u16, status: PortStatus, service: Option<String>) -> Self {
        Self {
            port,
            open: matches!(status, PortStatus::Open),
            status,
            service,
            latency_ms: None,
            banner: None,
            http: None,
            tls: None,
            raw: None,
            error: None,
        }
    }

    pub(super) fn with_latency(mut self, latency_ms: u64) -> Self {
        self.latency_ms = Some(latency_ms);
        self
    }

    pub(super) fn with_error(mut self, error: String) -> Self {
        self.error = Some(error);
        self
    }
}
