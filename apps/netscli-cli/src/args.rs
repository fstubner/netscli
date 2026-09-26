use clap::{Args, Parser, Subcommand};
use clap_complete::Shell;

#[derive(Parser)]
#[command(name = "netscli", version, about = "Modern network scanner", long_about = None)]
pub struct Cli {
    /// Max in-flight network operations (default 256; clamped to [1, 1024];
    /// mDNS discovery sub-caps internally at 32). Lower this on fragile home
    /// gateways that struggle with hundreds of simultaneous probes.
    #[arg(short = 'j', long, global = true, value_name = "N")]
    pub concurrency: Option<usize>,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

/// `--json` / `--yaml`, for commands whose result is not a list of rows.
#[derive(Args, Clone, Copy, Debug)]
pub struct StructuredOutput {
    /// Output JSON
    #[arg(long)]
    pub json: bool,

    /// Output YAML
    #[arg(long)]
    pub yaml: bool,
}

/// `--json` / `--yaml` / `--csv` / `--md`, for commands that return a list:
/// one table row per host, port, record or packet.
#[derive(Args, Clone, Copy, Debug)]
pub struct ListOutput {
    /// Output JSON
    #[arg(long)]
    pub json: bool,

    /// Output YAML
    #[arg(long)]
    pub yaml: bool,

    /// Output CSV, one row per result
    #[arg(long)]
    pub csv: bool,

    /// Output a Markdown table, one row per result
    #[arg(long)]
    pub md: bool,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Guided first-run setup / dependency wizard
    Setup {
        /// Print recommended commands only (do not execute)
        #[arg(long)]
        print: bool,

        /// Execute recommended install commands (may prompt for sudo)
        #[arg(long)]
        execute: bool,
    },

    /// Dependency and capability diagnostics (headless)
    Doctor {
        #[command(flatten)]
        format: StructuredOutput,
    },

    /// Discover live hosts on a network subnet
    Discover {
        /// CIDR subnet (e.g., 192.168.1.0/24)
        subnet: Option<String>,

        /// Resolve hostnames
        #[arg(long)]
        resolve: bool,

        #[command(flatten)]
        format: ListOutput,
    },

    /// Scan TCP ports on a host, or UDP with --udp
    Scan {
        /// Host to scan
        host: String,

        /// Ports to scan (comma-separated or range)
        #[arg(short, long)]
        ports: Option<String>,

        /// Scan UDP: DNS, NTP, NetBIOS, SSDP and mDNS, or --ports
        #[arg(long)]
        udp: bool,

        #[command(flatten)]
        format: ListOutput,
    },

    /// Comprehensive host inspection
    Inspect {
        /// Host to inspect
        host: String,

        /// Ports to scan
        #[arg(short, long)]
        ports: Option<String>,

        #[command(flatten)]
        format: StructuredOutput,
    },

    /// Network sweep (discover hosts then scan ports)
    Sweep {
        /// CIDR subnet
        subnet: Option<String>,

        /// Ports to scan
        #[arg(short, long)]
        ports: Option<String>,

        /// Resolve hostnames
        #[arg(long)]
        resolve: bool,

        #[command(flatten)]
        format: ListOutput,
    },

    /// DNS lookup
    Dns {
        /// Host to lookup
        host: String,

        /// Record type (A, AAAA, CNAME, MX, NS, TXT, SRV, PTR, SOA, CAA, ALL/ANY)
        #[arg(long)]
        record: Option<String>,

        #[command(flatten)]
        format: ListOutput,
    },

    /// Reverse DNS lookup
    Reverse {
        /// IP address to reverse lookup
        ip: String,

        #[command(flatten)]
        format: StructuredOutput,
    },

    /// Ping a host (basic)
    Ping {
        /// Host to ping (IP or hostname)
        host: String,

        /// Number of pings to send
        #[arg(short = 'c', long, default_value_t = 4)]
        count: u32,

        #[command(flatten)]
        format: ListOutput,
    },

    /// Trace route to a host (hops)
    Trace {
        /// Host to trace (IP or hostname)
        host: String,

        /// Resolve hop hostnames (slower)
        #[arg(long)]
        resolve: bool,

        /// Maximum hops
        #[arg(long, default_value_t = 30)]
        max_hops: u32,

        #[command(flatten)]
        format: StructuredOutput,
    },

    /// Show or manage ARP table
    #[command(group(
        clap::ArgGroup::new("arp_action")
            .args(["add", "delete", "clear"])
            .multiple(false)
    ))]
    Arp {
        /// Add an ARP entry (requires --ip and --mac)
        #[arg(long)]
        add: bool,

        /// Delete an ARP entry (requires --ip)
        #[arg(long)]
        delete: bool,

        /// Clear ARP table
        #[arg(long)]
        clear: bool,

        /// IP address for add/delete
        #[arg(long)]
        ip: Option<String>,

        /// MAC address for add
        #[arg(long)]
        mac: Option<String>,

        #[command(flatten)]
        format: ListOutput,
    },

    /// Capture network packets to PCAP file
    #[cfg(feature = "pcap")]
    #[command(group(
        // Exactly one mode: list devices, parse an existing file, or capture
        // from an interface.
        clap::ArgGroup::new("pcap_mode")
            .args(["interface", "read", "check"])
            .required(true)
            .multiple(false)
    ))]
    Pcap {
        /// Network interface name (required unless --check is used)
        #[arg(short, long)]
        interface: Option<String>,

        /// Read and summarize packets from an existing PCAP file
        #[arg(long, value_name = "FILE")]
        read: Option<String>,

        /// Filter expression (BPF)
        #[arg(long)]
        filter: Option<String>,

        /// Duration seconds (defaults to a bounded capture when --max-packets is omitted)
        #[arg(long)]
        duration: Option<u64>,

        /// Max packets to capture, or max parsed packet rows to return with --read
        #[arg(long)]
        max_packets: Option<usize>,

        /// Output file
        #[arg(long, default_value = "capture.pcap")]
        output: String,

        /// Only check pcap support and list capture devices
        #[arg(long)]
        check: bool,

        #[command(flatten)]
        format: ListOutput,
    },

    /// List interfaces
    Interfaces {
        #[command(flatten)]
        format: ListOutput,
    },

    /// Discover devices on the local network via mDNS/DNS-SD (Bonjour)
    Mdns {
        /// Browse window in milliseconds. Longer = more devices found,
        /// since many announce on a multi-second cadence.
        #[arg(long, default_value_t = 3000)]
        timeout_ms: u64,

        /// Service types to browse (repeatable). Defaults to a curated set
        /// of common types (_http._tcp, _ssh._tcp, _airplay._tcp, etc.).
        #[arg(long = "type", short = 't')]
        service_types: Vec<String>,

        #[command(flatten)]
        format: ListOutput,
    },

    /// Start MCP server for AI agents
    #[command(name = "serve")]
    McpServe,

    /// Print shell-completion script for the requested shell.
    ///
    /// Typical usage:
    ///   bash:       netscli completions bash       > ~/.local/share/bash-completion/completions/netscli
    ///   zsh:        netscli completions zsh        > ~/.zsh/completions/_netscli
    ///   fish:       netscli completions fish       > ~/.config/fish/completions/netscli.fish
    ///   powershell: netscli completions powershell > $PROFILE/netscli.ps1
    #[command(name = "completions")]
    Completions { shell: Shell },

    /// Print the roff-format man page to stdout.
    ///
    /// Typical usage: netscli man | gzip > /usr/share/man/man1/netscli.1.gz
    #[command(name = "man")]
    Man,

    /// Manage MCP server auto-start (systemd service)
    McpService {
        /// Generate systemd user service file
        #[arg(long)]
        install: bool,

        /// Remove systemd user service file
        #[arg(long)]
        uninstall: bool,

        /// Show service status
        #[arg(long)]
        status: bool,
    },
}
