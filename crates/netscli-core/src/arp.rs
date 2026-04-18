use crate::error::{Error, Result};
use crate::oui::lookup_vendor;
use ipnet::IpNet;
#[cfg(not(windows))]
use ipnetwork::IpNetwork;
use mac_address::MacAddress;
#[cfg(not(windows))]
use pnet_datalink;
use serde::Serialize;
use std::net::IpAddr;

#[derive(Debug, Clone, Serialize)]
pub struct ArpEntry {
    pub ip: IpAddr,
    pub mac: MacAddress,
    pub interface: String,
    pub vendor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InterfaceInfo {
    pub name: String,
    pub mac: Option<MacAddress>,
    pub ips: Vec<IpNet>,
    pub is_up: bool,
    pub is_loopback: bool,
}

pub struct NetworkManager;

impl NetworkManager {
    pub fn find_mac(ip: &IpAddr) -> Option<ArpEntry> {
        let table = Self::get_arp_table().ok()?;
        table.into_iter().find(|e| &e.ip == ip)
    }

    #[cfg(not(windows))]
    pub fn get_interfaces() -> Vec<InterfaceInfo> {
        pnet_datalink::interfaces()
            .into_iter()
            .map(|iface| {
                let name = iface.name.clone();
                let mac = iface.mac.map(|m| MacAddress::new(m.octets()));
                let is_up = iface.is_up();
                let is_loopback = iface.is_loopback();
                let ips = iface
                    .ips
                    .iter()
                    .filter_map(|n| convert_ipnetwork(*n))
                    .collect();
                InterfaceInfo {
                    name,
                    mac,
                    ips,
                    is_up,
                    is_loopback,
                }
            })
            .collect()
    }

    #[cfg(windows)]
    pub fn get_interfaces() -> Vec<InterfaceInfo> {
        use ipconfig::{IfType, OperStatus};

        let adapters = match ipconfig::get_adapters() {
            Ok(adapters) => adapters,
            Err(_) => return Vec::new(),
        };

        adapters
            .into_iter()
            .map(|adapter| {
                let name = adapter.friendly_name().to_string();
                let mac = adapter.physical_address().and_then(mac_from_bytes);
                let is_up = adapter.oper_status() == OperStatus::IfOperStatusUp;
                let is_loopback = adapter.if_type() == IfType::SoftwareLoopback;
                let prefixes = adapter.prefixes();
                let ips = adapter
                    .ip_addresses()
                    .iter()
                    .filter_map(|ip| ipnet_from_adapter(*ip, prefixes))
                    .collect();
                InterfaceInfo {
                    name,
                    mac,
                    ips,
                    is_up,
                    is_loopback,
                }
            })
            .collect()
    }

    #[cfg(target_os = "linux")]
    pub fn get_arp_table() -> Result<Vec<ArpEntry>> {
        use std::fs::File;
        use std::io::{BufRead, BufReader};
        use std::str::FromStr;

        let file = File::open("/proc/net/arp")?;
        let reader = BufReader::new(file);
        let mut entries = Vec::new();

        for line in reader.lines().skip(1) {
            let line = line?;
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 6 {
                if let (Ok(ip), Ok(mac)) =
                    (IpAddr::from_str(parts[0]), MacAddress::from_str(parts[3]))
                {
                    if parts[3] != "00:00:00:00:00:00" {
                        let vendor = lookup_vendor(parts[3].to_string().as_str());
                        entries.push(ArpEntry {
                            ip,
                            mac,
                            interface: parts[5].to_string(),
                            vendor,
                        });
                    }
                }
            }
        }
        Ok(entries)
    }

    #[cfg(target_os = "windows")]
    pub fn get_arp_table() -> Result<Vec<ArpEntry>> {
        use std::process::Command;
        use std::str::FromStr;
        let output = Command::new("arp").arg("-a").output()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let mut entries = Vec::new();

        // `arp -a` on Windows groups entries by interface. Each group begins with
        // a header like `Interface: 192.168.1.2 --- 0x5` followed by a column
        // header (`Internet Address      Physical Address      Type`) and then
        // rows. Track the current interface IP so entries are correctly attributed
        // instead of all being flattened to "unknown".
        let mut current_interface = String::from("unknown");

        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            // Section header: "Interface: <ip> --- <index>"
            if let Some(rest) = trimmed.strip_prefix("Interface:") {
                if let Some(iface_ip) = rest.split_whitespace().next() {
                    current_interface = iface_ip.to_string();
                }
                continue;
            }

            // Skip the "Internet Address ..." column header rows.
            if trimmed.starts_with("Internet Address") {
                continue;
            }

            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() < 3 {
                continue;
            }

            let Ok(ip) = IpAddr::from_str(parts[0]) else {
                continue;
            };
            let Ok(mac) = MacAddress::from_str(parts[1]) else {
                continue;
            };

            // `arp -a` emits MACs as `aa-bb-cc-dd-ee-ff` on Windows; the
            // `MacAddress` parser accepts both formats, but pass the raw token
            // to `lookup_vendor` since it already handles separators.
            let vendor = lookup_vendor(parts[1]);
            entries.push(ArpEntry {
                ip,
                mac,
                interface: current_interface.clone(),
                vendor,
            });
        }
        Ok(entries)
    }

    #[cfg(target_os = "macos")]
    pub fn get_arp_table() -> Result<Vec<ArpEntry>> {
        use std::process::Command;
        use std::str::FromStr;
        let output = Command::new("arp").arg("-an").output()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let mut entries = Vec::new();

        // Expected format:
        //   `? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]`
        // Variants we must tolerate without panicking:
        //   - `? (192.168.1.1) at (incomplete) on en0 ...`  (no MAC yet)
        //   - Lines with `permanent` in place of the interface token
        // Rather than indexing by position, walk the tokens and pick the
        // IP (parenthesized), the MAC (after `at`), and the interface (after `on`).
        for line in text.lines() {
            let tokens: Vec<&str> = line.split_whitespace().collect();
            let mut ip: Option<IpAddr> = None;
            let mut mac: Option<MacAddress> = None;
            let mut iface: Option<String> = None;
            let mut mac_token: Option<&str> = None;

            let mut i = 0;
            while i < tokens.len() {
                let tok = tokens[i];
                if tok.starts_with('(') && tok.ends_with(')') {
                    let cleaned = tok.trim_matches(&['(', ')'][..]);
                    if let Ok(parsed) = IpAddr::from_str(cleaned) {
                        ip = Some(parsed);
                    }
                } else if tok == "at" {
                    if let Some(next) = tokens.get(i + 1) {
                        if let Ok(parsed) = MacAddress::from_str(next) {
                            mac = Some(parsed);
                            mac_token = Some(*next);
                        }
                        i += 1;
                    }
                } else if tok == "on" {
                    if let Some(next) = tokens.get(i + 1) {
                        iface = Some((*next).to_string());
                        i += 1;
                    }
                }
                i += 1;
            }

            if let (Some(ip), Some(mac)) = (ip, mac) {
                let vendor = mac_token.and_then(lookup_vendor);
                entries.push(ArpEntry {
                    ip,
                    mac,
                    interface: iface.unwrap_or_default(),
                    vendor,
                });
            }
        }
        Ok(entries)
    }

    pub fn add_entry(ip: IpAddr, mac: MacAddress) -> Result<()> {
        use std::process::Command;
        #[cfg(target_os = "windows")]
        {
            let status = Command::new("arp")
                .args(["-s", &ip.to_string(), &mac.to_string().replace(":", "-")])
                .status()?;
            if !status.success() {
                return Err(Error::Other(
                    "Failed to add ARP entry (run as admin?)".into(),
                ));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let status = Command::new("arp")
                .args(["-s", &ip.to_string(), &mac.to_string()])
                .status()?;
            if !status.success() {
                return Err(Error::Other(
                    "Failed to add ARP entry (requires root/admin privileges)".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn delete_entry(ip: IpAddr) -> Result<()> {
        use std::process::Command;
        #[cfg(target_os = "windows")]
        {
            let status = Command::new("arp").args(["-d", &ip.to_string()]).status()?;
            if !status.success() {
                return Err(Error::Other(
                    "Failed to delete ARP entry (run as admin?)".into(),
                ));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let status = Command::new("arp").args(["-d", &ip.to_string()]).status()?;
            if !status.success() {
                return Err(Error::Other(
                    "Failed to delete ARP entry (requires root/admin privileges)".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn clear_table() -> Result<()> {
        use std::process::Command;
        #[cfg(target_os = "windows")]
        {
            let status = Command::new("arp").args(["-d", "*"]).status()?;
            if !status.success() {
                return Err(Error::Other(
                    "Failed to clear ARP table (run as admin?)".into(),
                ));
            }
        }
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            // On BSD/macOS 'arp -d -a', on Linux 'ip neigh flush all' is cleaner but 'arp -d' loop is common.
            // We'll try a best effort 'arp -d -a' for mac, and iterating for linux if needed, but let's assume
            // the user might just want to delete specific ones.
            // For simplicity in this cross-platform shim:
            #[cfg(target_os = "macos")]
            {
                let status = Command::new("arp").args(["-d", "-a"]).status()?;
                if !status.success() {
                    return Err(Error::Other("Failed to clear ARP table".into()));
                }
            }
            #[cfg(target_os = "linux")]
            {
                let status = Command::new("ip")
                    .args(["neigh", "flush", "all"])
                    .status()?;
                if !status.success() {
                    return Err(Error::Other(
                        "Failed to clear ARP table (iproute2 required)".into(),
                    ));
                }
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
fn convert_ipnetwork(net: IpNetwork) -> Option<IpNet> {
    match net {
        IpNetwork::V4(v4) => IpNet::new(IpAddr::V4(v4.ip()), v4.prefix()).ok(),
        IpNetwork::V6(v6) => IpNet::new(IpAddr::V6(v6.ip()), v6.prefix()).ok(),
    }
}

#[cfg(windows)]
fn ipnet_from_adapter(ip: IpAddr, prefixes: &[(IpAddr, u32)]) -> Option<IpNet> {
    let prefix_len = prefixes
        .iter()
        .find(|(prefix_ip, _)| prefix_ip.is_ipv4() == ip.is_ipv4())
        .map(|(_, len)| *len)
        .unwrap_or_else(|| if ip.is_ipv4() { 32 } else { 128 });
    IpNet::new(ip, prefix_len.min(128) as u8).ok()
}

#[cfg(windows)]
fn mac_from_bytes(bytes: &[u8]) -> Option<MacAddress> {
    if bytes.len() == 6 {
        Some(MacAddress::new([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5],
        ]))
    } else {
        None
    }
}
