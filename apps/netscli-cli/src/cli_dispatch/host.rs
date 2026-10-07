use super::CommandContext;
use crate::args::ListOutput;
use crate::output::{list_output_format, output_format, print_structured, OutputFormat};
use crate::trace;
use anyhow::Result;
use netscli_core::{sanitize_for_terminal, PingSummary, TraceResult};

pub(super) async fn run_ping(
    ctx: CommandContext<'_>,
    host: &str,
    count: u32,
    flags: ListOutput,
) -> Result<()> {
    let format = list_output_format(flags)?;
    let summary = ctx.ops.ping_host_summary(host, count).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml | OutputFormat::Csv | OutputFormat::Markdown => {
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
    require_reply(&summary)
}

/// A ping that nothing answered has failed, whatever the output format, so a
/// script can branch on the exit code. It runs after the summary is printed,
/// so the numbers are still there.
fn require_reply(summary: &PingSummary) -> Result<()> {
    if summary.received == 0 {
        anyhow::bail!(
            "no reply from {} ({} sent, 0 received)",
            summary.ip,
            summary.sent
        );
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
        OutputFormat::Json | OutputFormat::Yaml | OutputFormat::Csv | OutputFormat::Markdown => {
            print_structured(format, &res)?
        }
        OutputFormat::Text => {
            // Hop names come from PTR records of routers on the path, which
            // whoever runs those routers controls. This was the one plain-text
            // path still printing remote strings unsanitised.
            for line in &res.lines {
                println!("{}", sanitize_for_terminal(line));
            }
        }
    }
    require_success(&res)
}

/// A trace whose tool failed has failed, even though the tool's own message
/// was printed above as output. Reaching the end of the route without an
/// answer from the last hop is not a failure. `tracert` and `traceroute`
/// both exit 0 for that.
fn require_success(res: &TraceResult) -> Result<()> {
    let tool = std::path::Path::new(&res.tool)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(&res.tool);
    match res.exit_code {
        Some(0) => Ok(()),
        Some(code) => anyhow::bail!("{tool} failed with exit code {code}"),
        None => anyhow::bail!("{tool} was stopped before it finished"),
    }
}

pub(super) fn run_interfaces(ctx: CommandContext<'_>, flags: ListOutput) -> Result<()> {
    let format = list_output_format(flags)?;
    let ifaces = ctx.ops.list_interfaces();
    match format {
        OutputFormat::Json | OutputFormat::Yaml | OutputFormat::Csv | OutputFormat::Markdown => {
            print_structured(format, &ifaces)?
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(sent: u32, received: u32) -> PingSummary {
        PingSummary {
            host: "printer.lan".to_string(),
            ip: "10.0.0.9".parse().unwrap(),
            sent,
            received,
            loss_pct: 100.0 * f64::from(sent - received) / f64::from(sent),
            rtt_ms_min: None,
            rtt_ms_max: None,
            rtt_ms_avg: None,
        }
    }

    fn trace(exit_code: Option<i32>) -> TraceResult {
        TraceResult {
            host: "example.com".to_string(),
            // Windows runs `tracert` by its absolute path. Forward slashes,
            // because they separate a path on both Windows and Unix.
            tool: "C:/Windows/System32/tracert.exe".to_string(),
            exit_code,
            lines: vec!["Unable to resolve target system name example.com.".to_string()],
        }
    }

    #[test]
    fn a_ping_nobody_answered_fails() {
        let err = require_reply(&summary(4, 0)).unwrap_err().to_string();
        assert!(err.contains("10.0.0.9"), "{err}");
        assert!(err.contains("4 sent"), "{err}");
    }

    #[test]
    fn a_ping_with_some_loss_still_succeeds() {
        assert!(require_reply(&summary(4, 3)).is_ok());
        assert!(require_reply(&summary(4, 1)).is_ok());
        assert!(require_reply(&summary(4, 4)).is_ok());
    }

    #[test]
    fn a_trace_succeeds_only_when_the_tool_does() {
        assert!(require_success(&trace(Some(0))).is_ok());

        let failed = require_success(&trace(Some(1))).unwrap_err().to_string();
        assert_eq!(failed, "tracert failed with exit code 1");

        let killed = require_success(&trace(None)).unwrap_err().to_string();
        assert_eq!(killed, "tracert was stopped before it finished");
    }
}
