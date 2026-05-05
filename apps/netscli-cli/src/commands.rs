//! Per-command business logic for the CLI.
//!
//! Each `run_*` function does one thing: invoke the matching `Ops`
//! method, persist results to the local SQLite history if a database
//! handle is provided, and return the typed result for `main` to
//! format. Output formatting is intentionally kept in `main.rs` /
//! `cli_formatter.rs` so these functions stay reusable from the TUI
//! and any future surface that wants the raw data.
//!
//! `db_upsert_*_safe` and `db_add_scan_history_safe` log on failure
//! instead of propagating, so a corrupted history database never
//! kills a working scan. `try_init_db` does the same for opening
//! the DB itself: history is best-effort.
//!
//! Originally lived inline in `main.rs`; extracted here to keep the
//! CLI entry point focused on arg parsing + dispatch.
use anyhow::{Context, Result};
use dirs::home_dir;
use netscli_core::{Database, Ops};
use serde::Serialize;
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;

fn warn_nonfatal(context: &str, err: impl std::fmt::Display) {
    eprintln!("netscli: warning: {context}: {err}");
}

async fn db_upsert_host_safe(
    db: &Database,
    mac: &str,
    ip: Option<&str>,
    hostname: Option<&str>,
    vendor: Option<&str>,
) {
    if let Err(e) = db.upsert_host(mac, ip, hostname, vendor).await {
        warn_nonfatal("failed to record host in history", e);
    }
}

pub async fn db_add_scan_history_safe<T: Serialize>(
    db: &Database,
    kind: &str,
    duration_ms: i64,
    payload: &T,
) {
    let json = match serde_json::to_string(payload) {
        Ok(s) => s,
        Err(e) => {
            warn_nonfatal("failed to serialize history payload", e);
            return;
        }
    };
    if let Err(e) = db.add_scan_history(kind, duration_ms, &json).await {
        warn_nonfatal("failed to record scan history", e);
    }
}

async fn db_upsert_discovered_hosts_safe(db: &Database, hosts: &[netscli_core::Host]) {
    for h in hosts {
        if let Some(mac) = h.mac.as_deref() {
            // `host.ip` is `IpAddr`, not `String`; format it once per row.
            db_upsert_host_safe(
                db,
                mac,
                Some(&h.ip.to_string()),
                h.hostname.as_deref(),
                h.vendor.as_deref(),
            )
            .await;
        }
    }
}

async fn db_upsert_sweep_hosts_safe(db: &Database, entries: &[netscli_core::SweepEntry]) {
    for entry in entries {
        if let Some(mac) = entry.host.mac.as_deref() {
            db_upsert_host_safe(
                db,
                mac,
                Some(&entry.host.ip.to_string()),
                entry.host.hostname.as_deref(),
                entry.host.vendor.as_deref(),
            )
            .await;
        }
    }
}

pub async fn run_discover(
    ops: &Ops,
    db: Option<&Database>,
    subnet: Option<String>,
    resolve: bool,
    progress: Option<std::sync::Arc<dyn Fn(netscli_core::DiscoverProgress) + Send + Sync>>,
) -> Result<(String, Vec<netscli_core::Host>)> {
    let (subnet_str, hosts) = ops
        .discover_ipv4_with_progress(subnet, resolve, progress)
        .await?;
    if let Some(db) = db {
        db_upsert_discovered_hosts_safe(db, &hosts).await;
        db_add_scan_history_safe(db, "discover", 0, &hosts).await;
    }
    Ok((subnet_str, hosts))
}

pub async fn run_scan(
    ops: &Ops,
    db: Option<&Database>,
    host: &str,
    ports: Option<Vec<u16>>,
) -> Result<Vec<netscli_core::PortResult>> {
    let (_ip, results) = ops.scan_ports(host, ports).await?;
    if let Some(db) = db {
        db_add_scan_history_safe(db, "scan", 0, &results).await;
    }
    Ok(results)
}

pub async fn run_inspect(
    ops: &Ops,
    db: Option<&Database>,
    host: String,
    ports: Option<Vec<u16>>,
) -> Result<netscli_core::InspectResult> {
    let res = ops.inspect_host(host, ports).await?;
    if let Some(db) = db {
        db_add_scan_history_safe(db, "inspect", 0, &res).await;
    }
    Ok(res)
}

pub async fn run_sweep(
    ops: &Ops,
    db: Option<&Database>,
    subnet: Option<String>,
    ports: Option<Vec<u16>>,
    resolve_hostnames: bool,
    progress: Option<std::sync::Arc<dyn Fn(netscli_core::SweepProgress) + Send + Sync>>,
) -> Result<(String, Vec<netscli_core::SweepEntry>)> {
    let (subnet_str, entries) = ops
        .sweep_ipv4_with_progress(subnet, ports, resolve_hostnames, progress)
        .await?;
    if let Some(db) = db {
        db_upsert_sweep_hosts_safe(db, &entries).await;
        db_add_scan_history_safe(db, "sweep", 0, &entries).await;
    }
    Ok((subnet_str, entries))
}

pub async fn run_dns(
    ops: &Ops,
    db: Option<&Database>,
    host: &str,
    record: Option<String>,
) -> Result<Vec<netscli_core::dns::DnsRecord>> {
    let records = ops.dns_lookup(host, record).await?;
    if let Some(db) = db {
        db_add_scan_history_safe(db, "dns", 0, &records).await;
    }
    Ok(records)
}

pub fn print_dns_records_text(records: &[netscli_core::dns::DnsRecord]) {
    if records.is_empty() {
        println!("No DNS records found.");
        return;
    }

    let mut order: Vec<String> = Vec::new();
    let mut grouped: HashMap<String, Vec<String>> = HashMap::new();
    for record in records {
        if !grouped.contains_key(&record.record_type) {
            order.push(record.record_type.clone());
        }
        grouped
            .entry(record.record_type.clone())
            .or_default()
            .push(record.value.clone());
    }

    for (idx, record_type) in order.iter().enumerate() {
        if idx > 0 {
            println!();
        }
        println!("DNS {record_type}");
        if let Some(values) = grouped.get(record_type) {
            for value in values {
                println!("  {value}");
            }
        }
    }
}

pub async fn run_reverse(ops: &Ops, db: Option<&Database>, ip: &str) -> Result<Option<String>> {
    let ip: IpAddr = ip
        .parse()
        .context("Invalid IP address (expected IPv4 or IPv6)")?;
    let name =
        netscli_core::dns::reverse_lookup_best_effort_timeout(ip, ops.config().dns_timeout_ms)
            .await;
    if let Some(db) = db {
        db_add_scan_history_safe(db, "reverse", 0, &name).await;
    }
    Ok(name)
}

/// Open the local SQLite history database, swallowing any failure so a
/// corrupted DB never blocks a working scan. The user gets a one-line
/// warning and the rest of the CLI runs against an in-memory void.
pub async fn try_init_db() -> Option<Database> {
    match init_db().await {
        Ok(db) => Some(db),
        Err(e) => {
            eprintln!("netscli: warning: database unavailable ({e}); continuing without history");
            None
        }
    }
}

async fn init_db() -> Result<Database> {
    let base = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let db_path = base.join(".netscli").join("netscli.db");
    let parent = db_path
        .parent()
        .context("netscli db path has no parent directory")?;
    std::fs::create_dir_all(parent)?;
    let db = Database::new(db_path).await?;
    Ok(db)
}
