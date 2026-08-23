use mac_address::MacAddress;
use std::net::IpAddr;

use super::command;
use crate::error::{Error, Result};

pub(super) fn add_entry(ip: IpAddr, mac: MacAddress) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        let status = command::arp_command()
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
        let status = command::arp_command()
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
        let status = command::arp_command()
            .args(["-d", &ip.to_string()])
            .status()?;
        if !status.success() {
            return Err(Error::Other(
                "Failed to delete ARP entry (run as admin?)".into(),
            ));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = command::arp_command()
            .args(["-d", &ip.to_string()])
            .status()?;
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
        // `arp -d *` reports "The requested operation requires elevation."
        // and then exits 0, so the exit status alone says the table was
        // cleared when nothing was touched. That made the CLI print "ARP
        // table cleared" after doing nothing, and would make a discover run
        // straight afterwards report the very neighbours the user asked to
        // be rid of -- a silent wrong answer, which is the worst kind.
        //
        // On success the command prints nothing, so any output at all is a
        // failure. That test is locale-independent, unlike matching the
        // message text, and it fails loudly rather than quietly if a future
        // Windows build becomes chattier on success.
        let output = command::arp_command().args(["-d", "*"]).output()?;
        let mut reported = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if reported.is_empty() {
            reported = String::from_utf8_lossy(&output.stdout).trim().to_string();
        }
        if !output.status.success() || !reported.is_empty() {
            return Err(Error::Other(format!(
                "Failed to clear ARP table: {}",
                if reported.is_empty() {
                    "arp -d * failed (run as administrator?)".to_string()
                } else {
                    reported
                }
            )));
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
            let status = command::arp_command().args(["-d", "-a"]).status()?;
            if !status.success() {
                return Err(Error::Other("Failed to clear ARP table".into()));
            }
        }
        #[cfg(target_os = "linux")]
        {
            let status = command::command("ip")
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
