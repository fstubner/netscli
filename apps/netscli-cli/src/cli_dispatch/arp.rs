use super::CommandContext;
use crate::output::{output_format, print_structured, OutputFormat};
use anyhow::Result;
use mac_address::MacAddress;
use netscli_core::NetworkManager;
use serde::Serialize;
use std::net::IpAddr;
use std::str::FromStr;

#[allow(clippy::too_many_arguments)]
pub(super) async fn run(
    ctx: CommandContext<'_>,
    add: bool,
    delete: bool,
    clear: bool,
    ip: &Option<String>,
    mac: &Option<String>,
    json: bool,
    yaml: bool,
) -> Result<()> {
    let format = output_format(json, yaml)?;

    #[derive(Serialize)]
    struct ArpActionResult<'a> {
        action: &'a str,
        ip: Option<IpAddr>,
        ok: bool,
    }

    if clear {
        NetworkManager::clear_table()?;
        match format {
            OutputFormat::Json | OutputFormat::Yaml => {
                print_structured(
                    format,
                    &ArpActionResult {
                        action: "clear",
                        ip: None,
                        ok: true,
                    },
                )?;
            }
            OutputFormat::Text => println!("ARP table cleared"),
        }
        return Ok(());
    }
    if add {
        let ip = ip
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Missing --ip for ARP add"))?;
        let mac = mac
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Missing --mac for ARP add"))?;
        let ip: IpAddr = ip.parse()?;
        let mac = MacAddress::from_str(mac)?;
        NetworkManager::add_entry(ip, mac)?;
        match format {
            OutputFormat::Json | OutputFormat::Yaml => {
                print_structured(
                    format,
                    &ArpActionResult {
                        action: "add",
                        ip: Some(ip),
                        ok: true,
                    },
                )?;
            }
            OutputFormat::Text => println!("ARP entry added for {}", ip),
        }
        return Ok(());
    }
    if delete {
        let ip = ip
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Missing --ip for ARP delete"))?;
        let ip: IpAddr = ip.parse()?;
        NetworkManager::delete_entry(ip)?;
        match format {
            OutputFormat::Json | OutputFormat::Yaml => {
                print_structured(
                    format,
                    &ArpActionResult {
                        action: "delete",
                        ip: Some(ip),
                        ok: true,
                    },
                )?;
            }
            OutputFormat::Text => println!("ARP entry deleted for {}", ip),
        }
        return Ok(());
    }

    let entries = ctx.ops.get_arp_table().await?;
    match format {
        OutputFormat::Json | OutputFormat::Yaml => print_structured(format, &entries)?,
        OutputFormat::Text => {
            for e in entries {
                let vendor = e.vendor.as_deref().unwrap_or("-");
                println!("{} {} {} {}", e.ip, e.mac, e.interface, vendor);
            }
        }
    }
    Ok(())
}
