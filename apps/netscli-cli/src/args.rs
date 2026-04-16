use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "netscli", version, about = "Modern network scanner", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
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
        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
    },

    /// Discover live hosts on a network subnet
    Discover {
        /// CIDR subnet (e.g., 192.168.1.0/24)
        subnet: Option<String>,

        /// Resolve hostnames
        #[arg(long)]
        resolve: bool,

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
    },

    /// Scan TCP ports on a host
    Scan {
        /// Host to scan
        host: String,

        /// Ports to scan (comma-separated or range)
        #[arg(short, long)]
        ports: Option<String>,

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
    },

    /// Comprehensive host inspection
    Inspect {
        /// Host to inspect
        host: String,

        /// Ports to scan
        #[arg(short, long)]
        ports: Option<String>,

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
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

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
    },

    /// DNS lookup
    Dns {
        /// Host to lookup
        host: String,

        /// Record type (A, AAAA, CNAME, MX, NS, TXT, SRV, PTR, SOA, CAA, ALL/ANY)
        #[arg(long)]
        record: Option<String>,

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
    },

    /// Reverse DNS lookup
    Reverse {
        /// IP address to reverse lookup
        ip: String,

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
    },

    /// Ping a host (basic)
    Ping {
        /// Host to ping (IP or hostname)
        host: String,

        /// Number of pings to send
        #[arg(short = 'c', long, default_value_t = 4)]
        count: u32,

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
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

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
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

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
    },

    /// Capture network packets to PCAP file
    #[cfg(feature = "pcap")]
    #[command(group(
        // Either --check (list devices, don't capture) or a real capture
        // with --interface. This keeps the old `--check` UX ergonomic —
        // users shouldn't have to supply a dummy interface just to list.
        clap::ArgGroup::new("pcap_mode")
            .args(["interface", "check"])
            .required(true)
            .multiple(true)
    ))]
    Pcap {
        /// Network interface name (required unless --check is used)
        #[arg(short, long)]
        interface: Option<String>,

        /// Filter expression (BPF)
        #[arg(long)]
        filter: Option<String>,

        /// Duration seconds
        #[arg(long)]
        duration: Option<u64>,

        /// Max packets
        #[arg(long)]
        max_packets: Option<usize>,

        /// Output file
        #[arg(long, default_value = "capture.pcap")]
        output: String,

        /// Only check pcap support and list capture devices
        #[arg(long)]
        check: bool,

        /// Output JSON
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
    },

    /// List interfaces
    Interfaces {
        #[arg(long)]
        json: bool,

        /// Output YAML
        #[arg(long)]
        yaml: bool,
    },

    /// Start MCP server for AI agents
    #[command(name = "serve")]
    McpServe,

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
