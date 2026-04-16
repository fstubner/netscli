use futures::stream::{self, StreamExt};
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::Semaphore;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize)]
pub struct PortResult {
    pub port: u16,
    pub open: bool,
    pub service: Option<String>,
    /// Populated when the probe failed for reasons other than a closed port
    /// (e.g. the scanner's concurrency semaphore was closed). Omitted on
    /// normal open/closed results.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Concurrent TCP port scanner.
///
/// The `Arc<Semaphore>` caps TCP connects across *all* concurrent `scan_host`
/// calls on the same scanner instance. `buffer_unordered` alone would only
/// bound a single call — `SweepEngine` reuses one scanner across hundreds of
/// hosts in parallel, so without the shared permit pool a /24 sweep could
/// attempt hosts × ports simultaneous connects (easily 64k sockets).
pub struct PortScanner {
    semaphore: Arc<Semaphore>,
    concurrency: usize,
}

#[derive(Debug, Clone)]
pub struct PortScanProgress {
    pub completed: usize,
    pub total: usize,
    pub port: u16,
    pub open: bool,
    pub open_found: usize,
}

impl PortScanner {
    pub fn new(concurrency: usize) -> Self {
        let concurrency = concurrency.max(1);
        Self {
            semaphore: Arc::new(Semaphore::new(concurrency)),
            concurrency,
        }
    }

    pub async fn scan_host(
        &self,
        target: IpAddr,
        ports: Vec<u16>,
        timeout_ms: u64,
    ) -> Vec<PortResult> {
        self.scan_host_with_progress(target, ports, timeout_ms, None)
            .await
    }

    pub async fn scan_host_with_progress(
        &self,
        target: IpAddr,
        ports: Vec<u16>,
        timeout_ms: u64,
        progress: Option<Arc<dyn Fn(PortScanProgress) + Send + Sync>>,
    ) -> Vec<PortResult> {
        if ports.is_empty() {
            return Vec::new();
        }

        let total = ports.len();
        let completed = Arc::new(AtomicUsize::new(0));
        let open_found = Arc::new(AtomicUsize::new(0));

        stream::iter(ports)
            .map(|port| {
                let scanner = self.clone();
                let completed = completed.clone();
                let open_found = open_found.clone();
                let progress = progress.clone();
                async move {
                    let res = scanner.check_port(target, port, timeout_ms).await;
                    let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                    let open_count = if res.open {
                        open_found.fetch_add(1, Ordering::SeqCst) + 1
                    } else {
                        open_found.load(Ordering::SeqCst)
                    };

                    if let Some(cb) = &progress {
                        cb(PortScanProgress {
                            completed: done,
                            total,
                            port,
                            open: res.open,
                            open_found: open_count,
                        });
                    }

                    res
                }
            })
            .buffer_unordered(self.concurrency)
            .collect::<Vec<PortResult>>()
            .await
    }

    async fn check_port(&self, target: IpAddr, port: u16, timeout_ms: u64) -> PortResult {
        let _permit = match self.semaphore.acquire().await {
            Ok(p) => p,
            Err(_) => {
                // Semaphore closed — record the reason so downstream callers
                // can distinguish this from a genuinely closed port.
                return PortResult {
                    port,
                    open: false,
                    service: None,
                    error: Some("scanner shut down (semaphore closed)".to_string()),
                };
            }
        };

        let addr = SocketAddr::new(target, port);
        let result = timeout(Duration::from_millis(timeout_ms), TcpStream::connect(addr)).await;

        match result {
            Ok(Ok(_)) => PortResult {
                port,
                open: true,
                service: Self::guess_service(port),
                error: None,
            },
            Ok(Err(_)) | Err(_) => PortResult {
                port,
                open: false,
                service: None,
                error: None,
            },
        }
    }

    /// Map well-known port numbers to their canonical service name.
    ///
    /// Extended from the original 15-entry list to cover the services users
    /// most commonly encounter when scanning home/office networks.
    fn guess_service(port: u16) -> Option<String> {
        let name = match port {
            20 => "ftp-data",
            21 => "ftp",
            22 => "ssh",
            23 => "telnet",
            25 => "smtp",
            53 => "dns",
            67 => "dhcp-server",
            68 => "dhcp-client",
            69 => "tftp",
            80 => "http",
            110 => "pop3",
            111 => "rpcbind",
            123 => "ntp",
            135 => "msrpc",
            137 => "netbios-ns",
            138 => "netbios-dgm",
            139 => "netbios-ssn",
            143 => "imap",
            161 => "snmp",
            162 => "snmp-trap",
            389 => "ldap",
            443 => "https",
            445 => "smb",
            465 => "smtps",
            514 => "syslog",
            587 => "smtp-submission",
            636 => "ldaps",
            873 => "rsync",
            993 => "imaps",
            995 => "pop3s",
            1080 => "socks",
            1433 => "mssql",
            1521 => "oracle",
            1723 => "pptp",
            1883 => "mqtt",
            2049 => "nfs",
            2375 => "docker",
            2376 => "docker-tls",
            3000 => "dev-http",
            3306 => "mysql",
            3389 => "rdp",
            4369 => "epmd",
            5000 => "upnp",
            5060 => "sip",
            5061 => "sips",
            5222 => "xmpp-client",
            5432 => "postgresql",
            5601 => "kibana",
            5672 => "amqp",
            5900 => "vnc",
            5984 => "couchdb",
            6379 => "redis",
            6443 => "kubernetes-api",
            6667 => "irc",
            7000 => "cassandra",
            8000 => "dev-http",
            8008 => "http-alt",
            8080 => "http-alt",
            8081 => "http-alt",
            8086 => "influxdb",
            8443 => "https-alt",
            8888 => "http-alt",
            9000 => "http-alt",
            9042 => "cassandra",
            9090 => "prometheus",
            9092 => "kafka",
            9200 => "elasticsearch",
            9418 => "git",
            11211 => "memcached",
            15672 => "rabbitmq-mgmt",
            27017 => "mongodb",
            27018 => "mongodb",
            50000 => "sap",
            _ => return None,
        };
        Some(name.to_string())
    }
}

impl Clone for PortScanner {
    fn clone(&self) -> Self {
        Self {
            semaphore: self.semaphore.clone(),
            concurrency: self.concurrency,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_guess_service() {
        assert_eq!(PortScanner::guess_service(22), Some("ssh".to_string()));
        assert_eq!(PortScanner::guess_service(80), Some("http".to_string()));
        assert_eq!(PortScanner::guess_service(443), Some("https".to_string()));
        assert_eq!(PortScanner::guess_service(9999), None);
    }

    #[test]
    fn test_port_scanner_creation() {
        let scanner = PortScanner::new(256);
        assert_eq!(scanner.concurrency, 256);
    }

    #[tokio::test]
    async fn test_scan_localhost_common_ports() {
        let scanner = PortScanner::new(10);
        let localhost: IpAddr = "127.0.0.1".parse().unwrap();
        let ports = vec![22, 80, 443, 8080];

        let results = scanner.scan_host(localhost, ports.clone(), 1000).await;

        assert_eq!(results.len(), ports.len());
        for result in results {
            assert!(ports.contains(&result.port));
            // Verify structure: if open, service may be set; if closed, service should be None
            if result.open {
                // Open ports may have service names for known ports
                if result.service.is_some() {
                    // Service name should match expected for known ports
                    match result.port {
                        22 => assert_eq!(result.service, Some("ssh".to_string())),
                        80 => assert_eq!(result.service, Some("http".to_string())),
                        443 => assert_eq!(result.service, Some("https".to_string())),
                        8080 => assert_eq!(result.service, Some("http-alt".to_string())),
                        _ => {}
                    }
                }
            } else {
                // Closed ports should not have service names
                assert_eq!(result.service, None);
            }
        }
    }
}
