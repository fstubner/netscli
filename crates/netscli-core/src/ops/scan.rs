use std::net::IpAddr;
use std::sync::Arc;

use super::config::Ops;
use super::validation::parse_limited_ipv4_subnet;
use crate::error::Result;
use crate::{
    default_ipv4_subnet_string, default_ports, validate_ports, DiscoverEngine, Host, InspectEngine,
    InspectResult, PortResult, PortScanner, SweepEngine, SweepEntry,
};

/// Resolve the caller's port list, validating it.
///
/// Every scanning entry point funnels through here so the limits hold no
/// matter which surface the call arrives on. Previously the 4,096 cap and
/// the port-0 rejection lived only in the *parsers* — `parse_ports_checked`
/// for the CLI/GUI and the MCP server's own `normalize_ports` — so the
/// answers diverged (`netscli scan -p 0` reported "Scanned 1 port" while
/// the MCP tool rejected the same input), and a library consumer calling
/// `Ops` with a hand-built `Vec<u16>` bypassed both.
fn resolve_ports(ports: Option<Vec<u16>>) -> Result<Vec<u16>> {
    match ports {
        Some(ports) => {
            validate_ports(&ports)?;
            Ok(ports)
        }
        None => Ok(default_ports()),
    }
}

impl Ops {
    pub async fn discover_ipv4(
        &self,
        subnet: Option<String>,
        resolve: bool,
    ) -> Result<(String, Vec<Host>)> {
        self.discover_ipv4_with_progress(subnet, resolve, None)
            .await
    }

    pub async fn discover_ipv4_with_progress(
        &self,
        subnet: Option<String>,
        resolve: bool,
        progress: Option<Arc<dyn Fn(crate::discover::DiscoverProgress) + Send + Sync>>,
    ) -> Result<(String, Vec<Host>)> {
        let subnet_str = subnet.unwrap_or_else(default_ipv4_subnet_string);
        let net = parse_limited_ipv4_subnet(&subnet_str)?;
        let engine = DiscoverEngine::new_with_timeouts(
            self.cfg.concurrency,
            self.cfg.ping_timeout_ms,
            self.cfg.dns_timeout_ms,
        );
        let hosts = engine
            .scan_subnet_with_progress(net, resolve, progress)
            .await?;
        Ok((subnet_str, hosts))
    }

    pub async fn scan_ports(
        &self,
        host: &str,
        ports: Option<Vec<u16>>,
    ) -> Result<(IpAddr, Vec<PortResult>)> {
        self.scan_ports_with_progress(host, ports, None).await
    }

    pub async fn scan_ports_with_progress(
        &self,
        host: &str,
        ports: Option<Vec<u16>>,
        progress: Option<Arc<dyn Fn(crate::scan::PortScanProgress) + Send + Sync>>,
    ) -> Result<(IpAddr, Vec<PortResult>)> {
        let ip = self.resolve_host_ip(host).await?;
        let ports = resolve_ports(ports)?;
        let scanner = PortScanner::new(self.cfg.concurrency);
        let results = scanner
            .scan_host_with_progress(ip, ports, self.cfg.scan_timeout_ms, progress)
            .await?;
        Ok((ip, results))
    }

    pub async fn inspect_host(
        &self,
        host: String,
        ports: Option<Vec<u16>>,
    ) -> Result<InspectResult> {
        let ports = resolve_ports(ports)?;
        let engine = InspectEngine::new_with_timeouts(
            self.cfg.concurrency,
            self.cfg.ping_timeout_ms,
            self.cfg.scan_timeout_ms,
            self.cfg.dns_timeout_ms,
        );
        engine.inspect(host, ports).await
    }

    pub async fn sweep_ipv4(
        &self,
        subnet: Option<String>,
        ports: Option<Vec<u16>>,
        resolve_hostnames: bool,
    ) -> Result<(String, Vec<SweepEntry>)> {
        self.sweep_ipv4_with_progress(subnet, ports, resolve_hostnames, None)
            .await
    }

    pub async fn sweep_ipv4_with_progress(
        &self,
        subnet: Option<String>,
        ports: Option<Vec<u16>>,
        resolve_hostnames: bool,
        progress: Option<Arc<dyn Fn(crate::sweep::SweepProgress) + Send + Sync>>,
    ) -> Result<(String, Vec<SweepEntry>)> {
        let subnet_str = subnet.unwrap_or_else(default_ipv4_subnet_string);
        let net = parse_limited_ipv4_subnet(&subnet_str)?;
        let ports = resolve_ports(ports)?;
        let engine = SweepEngine::new_with_timeouts(
            self.cfg.concurrency,
            self.cfg.ping_timeout_ms,
            self.cfg.scan_timeout_ms,
            self.cfg.dns_timeout_ms,
        );
        let results = engine
            .sweep_with_progress(net, ports, resolve_hostnames, progress)
            .await?;
        Ok((subnet_str, results))
    }
}
