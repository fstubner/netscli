use super::CommandContext;
use crate::cli_formatter::CliFormatter;
use crate::commands;
use crate::output::{output_format, print_structured, OutputFormat};
use anyhow::Result;

#[allow(clippy::too_many_arguments)]
pub(super) async fn run(
    ctx: CommandContext<'_>,
    interface: &Option<String>,
    read: &Option<String>,
    filter: &Option<String>,
    duration: Option<u64>,
    max_packets: Option<usize>,
    output: &str,
    check: bool,
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    if check {
        let devs = ctx.ops.pcap_check_support()?;
        match format {
            OutputFormat::Json | OutputFormat::Yaml => {
                print_structured(format, &devs)?;
            }
            OutputFormat::Text => {
                println!("pcap available. Interfaces:");
                for d in devs {
                    println!("  {}", d);
                }
            }
        }
        return Ok(());
    }

    if let Some(input) = read {
        let parsed = ctx.ops.parse_pcap_file(input.clone(), max_packets)?;
        match format {
            OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &parsed)?,
            OutputFormat::Text => {
                println!("{}", CliFormatter::format_pcap_parse_result(&parsed));
            }
        }
        return Ok(());
    }

    // Not --check → --interface is required. clap's ArgGroup lets
    // you supply either, so we enforce the conditional here.
    let interface = interface
        .clone()
        .ok_or_else(|| anyhow::anyhow!("--interface is required when not using --check"))?;

    let res = ctx
        .ops
        .capture_pcap_async(
            interface,
            filter.clone(),
            duration,
            Some(output.to_string()),
            max_packets,
        )
        .await?;

    if let Some(db) = ctx.db {
        commands::db_add_scan_history_safe(db, "pcap", res.duration.as_millis() as i64, &res).await;
    }

    match format {
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &res)?,
        OutputFormat::Text => {
            println!(
                "Captured {} packets to {:?}",
                res.packets_captured, res.file_path
            );
        }
    }

    Ok(())
}
