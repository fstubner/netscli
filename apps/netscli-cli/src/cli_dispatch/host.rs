use super::CommandContext;
use crate::output::{output_format, print_structured, OutputFormat};
use crate::trace;
use anyhow::Result;
use netscli_core::sanitize_for_terminal;

pub(super) async fn run_ping(
    ctx: CommandContext<'_>,
    host: &str,
    count: u32,
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    let summary = ctx.ops.ping_host_summary(host, count).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => {
            print_structured(format, &summary)?;
        }
        OutputFormat::Text => {
            println!("PING {} ({})", summary.host, summary.ip);
            println!(
                "sent={} received={} loss={:.1}%",
                summary.sent, summary.received, summary.loss_pct
            );
            if let (Some(min), Some(max)) = (summary.rtt_ms_min, summary.rtt_ms_max) {
                if let Some(avg) = summary.rtt_ms_avg {
                    println!("rtt min/avg/max = {min}/{avg:.1}/{max} ms");
                }
            }
        }
    }
    Ok(())
}

pub(super) async fn run_trace(
    host: &str,
    resolve: bool,
    max_hops: u32,
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    let res = trace::trace_route(host, max_hops, resolve, None).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &res)?,
        OutputFormat::Text => {
            // Hop names come from PTR records of routers on the path, which
            // whoever runs those routers controls. This was the one plain-text
            // path still printing remote strings unsanitised.
            for line in res.lines {
                println!("{}", sanitize_for_terminal(&line));
            }
        }
    }
    Ok(())
}

pub(super) fn run_interfaces(ctx: CommandContext<'_>, json: bool, yaml: bool) -> Result<()> {
    let format = output_format(json, yaml)?;
    let ifaces = ctx.ops.list_interfaces();
    match format {
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &ifaces)?,
        OutputFormat::Text => {
            for iface in ifaces {
                println!(
                    "{} up={} loopback={}",
                    iface.name, iface.is_up, iface.is_loopback
                );
                for ip in iface.ips {
                    println!("  {}", ip);
                }
            }
        }
    }
    Ok(())
}
