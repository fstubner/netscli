use mac_address::MacAddress;
use std::net::IpAddr;

#[cfg(any(target_os = "windows", target_os = "macos"))]
use super::command;
use crate::arp::types::ArpEntry;
#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
use crate::error::Error;
use crate::error::Result;
use crate::oui::lookup_vendor;

#[cfg(target_os = "linux")]
pub(super) fn get_arp_table() -> Result<Vec<ArpEntry>> {
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
            if let (Ok(ip), Ok(mac)) = (IpAddr::from_str(parts[0]), MacAddress::from_str(parts[3]))
            {
                if parts[3] != "00:00:00:00:00:00" {
                    let vendor = lookup_vendor(parts[3]);
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
pub(super) fn get_arp_table() -> Result<Vec<ArpEntry>> {
    use std::str::FromStr;

    let output = command::arp_command().arg("-a").output()?;
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

        if let Some(rest) = trimmed.strip_prefix("Interface:") {
            if let Some(iface_ip) = rest.split_whitespace().next() {
                current_interface = iface_ip.to_string();
            }
            continue;
        }

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
pub(super) fn get_arp_table() -> Result<Vec<ArpEntry>> {
    use std::str::FromStr;

    let output = command::arp_command().arg("-an").output()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();

    // Expected format:
    //   `? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]`
    // Variants we must tolerate without panicking:
    //   - `? (192.168.1.1) at (incomplete) on en0 ...`  (no MAC yet)
    //   - Lines with `permanent` in place of the interface token
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

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
pub(super) fn get_arp_table() -> Result<Vec<ArpEntry>> {
    Err(Error::Other(
        "ARP table lookup is not supported on this platform".into(),
    ))
}
