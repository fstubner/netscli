mod arp;
mod dns;
mod docs;
mod host;
mod mdns;
#[cfg(feature = "pcap")]
mod pcap;
mod scan;

use crate::args::{Cli, Commands};
use crate::{mcp_service, setup};
use anyhow::Result;
use netscli_core::{Database, Ops};

#[derive(Clone, Copy)]
pub(crate) struct CommandContext<'a> {
    pub(crate) ops: &'a Ops,
    pub(crate) db: Option<&'a Database>,
    pub(crate) local_addr: Option<&'a str>,
}

pub(crate) async fn run_command(command: &Commands, ctx: CommandContext<'_>) -> Result<()> {
    match command {
        Commands::Setup { print, execute } => {
            setup::run_setup(*execute, *print).await?;
        }
        Commands::Doctor { json, yaml } => {
            setup::print_status(*json, *yaml).await?;
        }
        Commands::Discover {
            subnet,
            resolve,
            json,
            yaml,
        } => {
            scan::run_discover(ctx, subnet, *resolve, *json, *yaml).await?;
        }
        Commands::Scan {
            host,
            ports,
            json,
            yaml,
        } => {
            scan::run_scan(ctx, host, ports, *json, *yaml).await?;
        }
        Commands::Inspect {
            host,
            ports,
            json,
            yaml,
        } => {
            scan::run_inspect(ctx, host, ports, *json, *yaml).await?;
        }
        Commands::Sweep {
            subnet,
            ports,
            resolve,
            json,
            yaml,
        } => {
            scan::run_sweep(ctx, subnet, ports, *resolve, *json, *yaml).await?;
        }
        Commands::Dns {
            host,
            record,
            json,
            yaml,
        } => {
            dns::run_lookup(ctx, host, record, *json, *yaml).await?;
        }
        Commands::Reverse { ip, json, yaml } => {
            dns::run_reverse(ctx, ip, *json, *yaml).await?;
        }
        Commands::Ping {
            host,
            count,
            json,
            yaml,
        } => {
            host::run_ping(ctx, host, *count, *json, *yaml).await?;
        }
        Commands::Trace {
            host,
            resolve,
            max_hops,
            json,
            yaml,
        } => {
            host::run_trace(host, *resolve, *max_hops, *json, *yaml).await?;
        }
        Commands::Arp {
            add,
            delete,
            clear,
            ip,
            mac,
            json,
            yaml,
        } => {
            arp::run(ctx, *add, *delete, *clear, ip, mac, *json, *yaml)?;
        }
        #[cfg(feature = "pcap")]
        Commands::Pcap {
            interface,
            read,
            filter,
            duration,
            max_packets,
            output,
            check,
            json,
            yaml,
        } => {
            pcap::run(
                ctx,
                interface,
                read,
                filter,
                *duration,
                *max_packets,
                output,
                *check,
                *json,
                *yaml,
            )
            .await?;
        }
        Commands::Interfaces { json, yaml } => {
            host::run_interfaces(ctx, *json, *yaml)?;
        }
        Commands::Mdns {
            timeout_ms,
            service_types,
            json,
            yaml,
        } => {
            mdns::run(ctx, *timeout_ms, service_types, *json, *yaml).await?;
        }
        Commands::Completions { shell } => {
            docs::print_completions::<Cli>(*shell);
        }
        Commands::Man => {
            docs::print_man::<Cli>()?;
        }
        Commands::McpServe => {
            netscli_mcp::run_server().await?;
        }
        Commands::McpService {
            install,
            uninstall,
            status,
        } => {
            if *install {
                mcp_service::install_service()?;
            } else if *uninstall {
                mcp_service::uninstall_service()?;
            } else if *status {
                mcp_service::show_status()?;
            } else {
                println!("Use --install, --uninstall, or --status");
            }
        }
    }

    Ok(())
}
