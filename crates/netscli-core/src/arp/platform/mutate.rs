use mac_address::MacAddress;
use std::net::IpAddr;
use std::process::Command;

use crate::error::{Error, Result};

pub(super) fn add_entry(ip: IpAddr, mac: MacAddress) -> Result<()> {
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

pub(super) fn delete_entry(ip: IpAddr) -> Result<()> {
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

pub(super) fn clear_table() -> Result<()> {
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
