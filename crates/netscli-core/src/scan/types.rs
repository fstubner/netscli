use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PortStatus {
    Open,
    Closed,
    Filtered,
    Error,
    /// UDP only: no reply and no port-unreachable. The service may be there
    /// and ignored a probe it didn't understand, or a firewall dropped it;
    /// UDP can't tell which. Serialized as nmap writes it.
    #[serde(rename = "open|filtered")]
    OpenFiltered,
}

/// Which transport a port result is for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    #[default]
    Tcp,
    Udp,
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
    /// `tcp` or `udp`. Added with UDP scanning; every result before that was
    /// TCP, which is what a consumer that ignores the field still assumes.
    pub protocol: Protocol,
    pub open: bool,
    pub status: PortStatus,
    pub service: Option<String>,
    /// The software on the port, when it named itself: the SSH
    /// identification line, an HTTP `Server` header, or a mail/FTP greeting.
    /// See `scan/version.rs`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
    /// That software's version, when it gave one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
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
            protocol: Protocol::Tcp,
            open: matches!(status, PortStatus::Open),
            status,
            service,
            product: None,
            version: None,
            latency_ms: None,
            banner: None,
            http: None,
            tls: None,
            raw: None,
            error: None,
        }
    }

    /// `OpenSSH 9.6p1` for display, or just `cloudflare` when the service
    /// named itself without a version. `None` when it did neither.
    pub fn product_and_version(&self) -> Option<String> {
        let product = self.product.as_deref()?;
        Some(match self.version.as_deref() {
            Some(version) => format!("{product} {version}"),
            None => product.to_string(),
        })
    }

    /// `53/udp` for a UDP result, the bare number for TCP, which is what
    /// every port meant before UDP scanning existed.
    pub fn port_label(&self) -> String {
        match self.protocol {
            Protocol::Udp => format!("{}/udp", self.port),
            Protocol::Tcp => self.port.to_string(),
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
