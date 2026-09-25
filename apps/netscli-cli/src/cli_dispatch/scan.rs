use super::CommandContext;
use crate::args::ListOutput;
use crate::cli_formatter::CliFormatter;
use crate::commands;
use crate::output::{list_output_format, output_format, print_structured, OutputFormat};
use anyhow::Result;
use netscli_core::{parse_ports_checked, Host, PortResult, SweepEntry};
use serde::Serialize;
use std::time::Instant;

pub(super) async fn run_discover(
    ctx: CommandContext<'_>,
    subnet: &Option<String>,
    resolve: bool,
    flags: ListOutput,
) -> Result<()> {
    let format = list_output_format(flags)?;
    let start = Instant::now();
    let (subnet_str, hosts) =
        commands::run_discover(ctx.ops, ctx.db, subnet.clone(), resolve, None).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml | OutputFormat::Csv | OutputFormat::Markdown => {
            print_structured(format, &hosts)?
        }
        OutputFormat::Text => {
            println!(
                "{}",
                CliFormatter::format_discover_result(&hosts, &subnet_str, start, ctx.local_addr)
            );
        }
    }
    Ok(())
}

pub(super) async fn run_scan(
    ctx: CommandContext<'_>,
    host: &str,
    ports: &Option<String>,
    flags: ListOutput,
) -> Result<()> {
    let format = list_output_format(flags)?;
    let start = Instant::now();
    let ports = parse_ports_checked(ports.as_deref())?;
    let results = commands::run_scan(ctx.ops, ctx.db, host, ports).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml | OutputFormat::Csv | OutputFormat::Markdown => {
            // Every port, not just the open ones. Filtering here made "all
            // closed", "all filtered" and "every probe errored" the same
            // empty array, so a script could not tell a clean scan from a
            // host that refused every probe -- a distinction the text
            // formatter has always shown. Each entry carries `open` and
            // `status`, so callers that want only open ports still can.
            print_structured(format, &results)?;
        }
        OutputFormat::Text => {
            println!(
                "{}",
                CliFormatter::format_scan_result(&results, host, start, ctx.local_addr)
            );
        }
    }
    Ok(())
}

pub(super) async fn run_inspect(
    ctx: CommandContext<'_>,
    host: &str,
    ports: &Option<String>,
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    let start = Instant::now();
    let ports = parse_ports_checked(ports.as_deref())?;
    let data = commands::run_inspect(ctx.ops, ctx.db, host.to_string(), ports).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml | OutputFormat::Csv | OutputFormat::Markdown => {
            print_structured(format, &data)?
        }
        OutputFormat::Text => {
            println!(
                "{}",
                CliFormatter::format_inspect_result(&data, start, ctx.local_addr)
            );
        }
    }
    Ok(())
}

pub(super) async fn run_sweep(
    ctx: CommandContext<'_>,
    subnet: &Option<String>,
    ports: &Option<String>,
    resolve: bool,
    flags: ListOutput,
) -> Result<()> {
    let format = list_output_format(flags)?;
    let start = Instant::now();
    let ports = parse_ports_checked(ports.as_deref())?;
    let (subnet_str, results) =
        commands::run_sweep(ctx.ops, ctx.db, subnet.clone(), ports, resolve, None).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &results)?,
        OutputFormat::Csv | OutputFormat::Markdown => {
            print_structured(format, &sweep_table_rows(&results))?
        }
        OutputFormat::Text => {
            println!(
                "{}",
                CliFormatter::format_sweep_result(&results, &subnet_str, start, ctx.local_addr)
            );
        }
    }
    Ok(())
}

/// A sweep row for `--csv` and `--md`: one per open port, with the host's fields
/// repeated on each, and one with empty port columns for a host that
/// answered but had nothing open.
///
/// The JSON nests each host's ports inside it. Kept that way, a CSV would put
/// a whole JSON array in one cell, which is no use in a table; this is
/// the same data one level flatter, under the same field names.
#[derive(Serialize)]
struct SweepTableRow<'a> {
    #[serde(flatten)]
    host: &'a Host,
    #[serde(flatten)]
    port: Option<&'a PortResult>,
}

fn sweep_table_rows(results: &[SweepEntry]) -> Vec<SweepTableRow<'_>> {
    results
        .iter()
        .flat_map(|entry| {
            let host = &entry.host;
            let ports: Vec<Option<&PortResult>> = if entry.open_ports.is_empty() {
                vec![None]
            } else {
                entry.open_ports.iter().map(Some).collect()
            };
            ports
                .into_iter()
                .map(move |port| SweepTableRow { host, port })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::csv_for_test;
    use netscli_core::{FoundBy, PortStatus};

    fn host(ip: &str) -> Host {
        Host {
            ip: ip.parse().unwrap(),
            hostname: None,
            mac: None,
            vendor: None,
            rtt_ms: Some(2),
            found_by: FoundBy::Probe,
            hostname_source: None,
        }
    }

    fn open(port: u16) -> PortResult {
        PortResult {
            port,
            open: true,
            status: PortStatus::Open,
            service: None,
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

    #[test]
    fn a_sweep_is_one_row_per_open_port_and_one_for_a_quiet_host() {
        let results = vec![
            SweepEntry {
                host: host("10.0.0.1"),
                open_ports: vec![],
            },
            SweepEntry {
                host: host("10.0.0.2"),
                open_ports: vec![open(22), open(443)],
            },
        ];
        let csv = csv_for_test(&sweep_table_rows(&results));
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(
            lines[0],
            "ip,hostname,mac,vendor,rtt_ms,found_by,hostname_source,port,open,status,service"
        );
        assert_eq!(lines[1], "10.0.0.1,,,,2,probe,,,,,");
        assert_eq!(lines[2], "10.0.0.2,,,,2,probe,,22,true,open,");
        assert_eq!(lines[3], "10.0.0.2,,,,2,probe,,443,true,open,");
        assert_eq!(lines.len(), 4);
    }
}
