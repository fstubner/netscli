use super::CommandContext;
use crate::cli_formatter::CliFormatter;
use crate::commands;
use crate::output::{output_format, print_structured, OutputFormat};
use anyhow::Result;
use netscli_core::parse_ports_checked;
use std::time::Instant;

pub(super) async fn run_discover(
    ctx: CommandContext<'_>,
    subnet: &Option<String>,
    resolve: bool,
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    let start = Instant::now();
    let (subnet_str, hosts) =
        commands::run_discover(ctx.ops, ctx.db, subnet.clone(), resolve, None).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &hosts)?,
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
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    let start = Instant::now();
    let ports = parse_ports_checked(ports.as_deref())?;
    let results = commands::run_scan(ctx.ops, ctx.db, host, ports).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => {
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
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &data)?,
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
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    let start = Instant::now();
    let ports = parse_ports_checked(ports.as_deref())?;
    let (subnet_str, results) =
        commands::run_sweep(ctx.ops, ctx.db, subnet.clone(), ports, resolve, None).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &results)?,
        OutputFormat::Text => {
            println!(
                "{}",
                CliFormatter::format_sweep_result(&results, &subnet_str, start, ctx.local_addr)
            );
        }
    }
    Ok(())
}
