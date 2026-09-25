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
        Commands::Doctor { format } => {
            setup::print_status(format.json, format.yaml).await?;
        }
        Commands::Discover {
            subnet,
            resolve,
            format,
        } => {
            scan::run_discover(ctx, subnet, *resolve, *format).await?;
        }
        Commands::Scan {
            host,
            ports,
            format,
        } => {
            scan::run_scan(ctx, host, ports, *format).await?;
        }
        Commands::Inspect {
            host,
            ports,
            format,
        } => {
            scan::run_inspect(ctx, host, ports, format.json, format.yaml).await?;
        }
        Commands::Sweep {
            subnet,
            ports,
            resolve,
            format,
        } => {
            scan::run_sweep(ctx, subnet, ports, *resolve, *format).await?;
        }
        Commands::Dns {
            host,
            record,
            format,
        } => {
            dns::run_lookup(ctx, host, record, *format).await?;
        }
        Commands::Reverse { ip, format } => {
            dns::run_reverse(ctx, ip, format.json, format.yaml).await?;
        }
        Commands::Ping {
            host,
            count,
            format,
        } => {
            host::run_ping(ctx, host, *count, *format).await?;
        }
        Commands::Trace {
            host,
            resolve,
            max_hops,
            format,
        } => {
            host::run_trace(host, *resolve, *max_hops, format.json, format.yaml).await?;
        }
        Commands::Arp {
            add,
            delete,
            clear,
            ip,
            mac,
            format,
        } => {
            arp::run(ctx, *add, *delete, *clear, ip, mac, *format).await?;
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
            format,
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
                *format,
            )
            .await?;
        }
        Commands::Interfaces { format } => {
            host::run_interfaces(ctx, *format)?;
        }
        Commands::Mdns {
            timeout_ms,
            service_types,
            format,
        } => {
            mdns::run(ctx, *timeout_ms, service_types, *format).await?;
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
