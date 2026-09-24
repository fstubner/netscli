use super::CommandContext;
use crate::cli_formatter::CliFormatter;
use crate::commands;
use crate::output::{output_format_with_csv, print_structured, OutputFormat};
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
    csv: bool,
) -> Result<()> {
    let format = output_format_with_csv(json, yaml, csv)?;
    if check {
        let devs = ctx.ops.pcap_check_support()?;
        match format {
            // args.rs makes --csv conflict with --check, so no Csv here.
            OutputFormat::Json | OutputFormat::Yaml | OutputFormat::Csv => {
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
            OutputFormat::Csv => print_structured(format, &parsed.packets)?,
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
        // One row per packet. The capture's own summary (count, file) is
        // what the text output prints; a CSV wants the packets.
        OutputFormat::Csv => print_structured(format, &res.packets)?,
        OutputFormat::Text => {
            println!(
                "Captured {} packets to {:?}",
                res.packets_captured, res.file_path
            );
        }
    }

    Ok(())
}
