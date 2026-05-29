use super::CommandContext;
use crate::commands;
use crate::output::{output_format, print_structured, OutputFormat};
use anyhow::Result;

pub(super) async fn run_lookup(
    ctx: CommandContext<'_>,
    host: &str,
    record: &Option<String>,
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    let records = commands::run_dns(ctx.ops, ctx.db, host, record.clone()).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => {
            print_structured(format, &records)?;
        }
        OutputFormat::Text => {
            commands::print_dns_records_text(&records);
        }
    }
    Ok(())
}

pub(super) async fn run_reverse(
    ctx: CommandContext<'_>,
    ip: &str,
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;
    let res = commands::run_reverse(ctx.ops, ctx.db, ip).await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &res)?,
        OutputFormat::Text => match res {
            Some(name) => println!("{}", name),
            None => println!("No PTR record found."),
        },
    }
    Ok(())
}
