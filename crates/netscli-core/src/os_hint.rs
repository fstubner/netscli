//! A best guess at a host's operating system, from clues a scan already has,
//! each named with where it came from.
//!
//! This is not nmap's `-O`. That sends deliberately malformed packets and
//! fingerprints how the TCP/IP stack answers, which needs raw sockets (so
//! administrator rights, and Npcap on Windows) and a fingerprint database
//! under nmap's own licence. The clues here need neither:
//!
//! - **SMB**: a Windows host's NTLM challenge states its exact version and
//!   build before any login (`os_hint/smb.rs`);
//! - **SSH banner**: OpenSSH usually names the distribution
//!   (`OpenSSH_9.6p1 Ubuntu-3ubuntu13`) or says `for_Windows`;
//! - **HTTP `Server` header**: `Apache/2.4.58 (Ubuntu)`, `Microsoft-IIS/10.0`;
//! - **open ports**: 135 with 445 is Windows' RPC and file sharing;
//! - **MAC vendor**: an Apple or Raspberry Pi network card;
//! - **ping TTL**: hosts start the TTL at 64 (Linux, macOS, most Unix), 128
//!   (Windows) or 255 (network gear), and a LAN hop barely lowers it.
//!
//! The strongest clue sets the family; every clue is kept as evidence, so a
//! reader can see both what was concluded and why, including clues that
//! disagree. It's a hint: a host can run anything behind any of these.

pub(crate) mod smb;

use serde::Serialize;

use crate::scan::PortResult;
use smb::SmbInfo;

/// A best guess at a host's operating system, and the clues behind it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OsHint {
    /// `Windows`, `Linux`, `macOS or iOS`, `FreeBSD`, `Unix-like` or
    /// `Network device`.
    pub family: String,
    /// More precise, when a clue said: `Windows 11 or Server 2025 (build
    /// 26100)`, `Ubuntu`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Every clue that pointed somewhere, strongest first, each naming its
    /// source: `SMB: Windows 10.0 build 26100`, `TTL 128`.
    pub evidence: Vec<String>,
}

impl OsHint {
    /// One line for display: the detail, with the family in front when the
    /// detail doesn't already say it (`Linux, Debian`, but not `Windows,
    /// Windows 11 ...`).
    pub fn summary(&self) -> String {
        match &self.detail {
            Some(detail) if detail.contains(&self.family) => detail.clone(),
            Some(detail) => format!("{}, {detail}", self.family),
            None => self.family.clone(),
        }
    }
}

/// What a scan knows about a host that bears on its OS.
pub(crate) struct Clues<'a> {
    pub(crate) ttl: Option<u8>,
    pub(crate) ports: &'a [PortResult],
    pub(crate) vendor: Option<&'a str>,
    pub(crate) smb: Option<&'a SmbInfo>,
}

struct Clue {
    strength: u8,
    family: &'static str,
    detail: Option<String>,
    evidence: String,
}

/// The hint the clues add up to, or `None` when none of them point anywhere.
pub(crate) fn hint(clues: &Clues) -> Option<OsHint> {
    let mut found: Vec<Clue> = Vec::new();
    found.extend(clues.smb.and_then(from_smb));
    for port in clues.ports.iter().filter(|port| port.open) {
        if let Some(banner) = port.banner.as_deref().filter(|b| b.starts_with("SSH-")) {
            found.extend(from_ssh_banner(banner));
        }
        let server = port.http.as_ref().and_then(|http| {
            http.headers
                .iter()
                .find(|h| h.name.eq_ignore_ascii_case("server"))
        });
        if let Some(server) = server {
            found.extend(from_server_header(&server.value));
        }
    }
    found.extend(from_ports(clues.ports));
    found.extend(clues.vendor.and_then(from_vendor));
    found.extend(clues.ttl.and_then(from_ttl));

    // Stable, so equally strong clues keep the order they were gathered in.
    found.sort_by_key(|clue| std::cmp::Reverse(clue.strength));
    let best = found.first()?;
    let detail = best.detail.clone().or_else(|| {
        found
            .iter()
            .filter(|clue| clue.family == best.family)
            .find_map(|clue| clue.detail.clone())
    });
    let mut evidence: Vec<String> = Vec::new();
    for clue in &found {
        if !evidence.contains(&clue.evidence) {
            evidence.push(clue.evidence.clone());
        }
    }
    Some(OsHint {
        family: best.family.to_string(),
        detail,
        evidence,
    })
}

fn clue(strength: u8, family: &'static str, detail: Option<&str>, evidence: String) -> Clue {
    Clue {
        strength,
        family,
        detail: detail.map(str::to_string),
        evidence,
    }
}

/// Only a real Windows build is taken as Windows. A server reporting build 0
/// isn't Windows' own SMB stack, so it says nothing either way.
fn from_smb(smb: &SmbInfo) -> Option<Clue> {
    if smb.build == 0 {
        return None;
    }
    let mut evidence = format!(
        "SMB: Windows {}.{} build {}",
        smb.major, smb.minor, smb.build
    );
    if let Some(name) = &smb.computer {
        evidence.push_str(&format!(", name {name}"));
    }
    let detail = format!(
        "{} (build {})",
        windows_name(smb.major, smb.minor, smb.build),
        smb.build
    );
    Some(clue(100, "Windows", Some(&detail), evidence))
}

/// The marketing names a Windows version number can mean. Client and server
/// share version numbers, and from Windows 10 on even the build overlaps, so
/// each is named as the pair it could be.
fn windows_name(major: u8, minor: u8, build: u16) -> String {
    match (major, minor) {
        (10, 0) if build >= 22000 => "Windows 11 or Server 2025".to_string(),
        (10, 0) => "Windows 10 or Server 2016-2022".to_string(),
        (6, 3) => "Windows 8.1 or Server 2012 R2".to_string(),
        (6, 2) => "Windows 8 or Server 2012".to_string(),
        (6, 1) => "Windows 7 or Server 2008 R2".to_string(),
        (6, 0) => "Windows Vista or Server 2008".to_string(),
        _ => format!("Windows {major}.{minor}"),
    }
}

/// `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13` names Ubuntu;
/// `SSH-2.0-OpenSSH_for_Windows_9.5` names Windows.
fn from_ssh_banner(banner: &str) -> Option<Clue> {
    const DISTROS: &[(&str, &str, &str)] = &[
        ("Ubuntu", "Linux", "Ubuntu"),
        ("Debian", "Linux", "Debian"),
        ("Raspbian", "Linux", "Raspberry Pi OS"),
        ("FreeBSD", "FreeBSD", "FreeBSD"),
    ];
    if banner.contains("for_Windows") {
        return Some(clue(
            70,
            "Windows",
            None,
            "SSH banner: OpenSSH for Windows".to_string(),
        ));
    }
    DISTROS.iter().find_map(|&(token, family, name)| {
        banner
            .contains(token)
            .then(|| clue(80, family, Some(name), format!("SSH banner: {name}")))
    })
}

/// `Apache/2.4.58 (Ubuntu)` names Ubuntu; IIS and HTTP.sys only run on
/// Windows.
fn from_server_header(value: &str) -> Option<Clue> {
    const MARKERS: &[(&str, &str, Option<&str>)] = &[
        ("(Ubuntu)", "Linux", Some("Ubuntu")),
        ("(Debian)", "Linux", Some("Debian")),
        ("(Raspbian)", "Linux", Some("Raspberry Pi OS")),
        ("(CentOS)", "Linux", Some("CentOS")),
        ("(Red Hat)", "Linux", Some("Red Hat")),
        ("(Fedora)", "Linux", Some("Fedora")),
        ("(Win64)", "Windows", None),
        ("(Win32)", "Windows", None),
        ("Microsoft-IIS", "Windows", None),
        ("Microsoft-HTTPAPI", "Windows", None),
    ];
    MARKERS.iter().find_map(|&(marker, family, detail)| {
        value.contains(marker).then(|| {
            let seen = marker.trim_matches(|c| c == '(' || c == ')');
            clue(60, family, detail, format!("HTTP server: {seen}"))
        })
    })
}

/// Windows' RPC endpoint mapper (135) alongside SMB (445).
fn from_ports(ports: &[PortResult]) -> Option<Clue> {
    let open = |n: u16| ports.iter().any(|p| p.port == n && p.open);
    (open(135) && open(445))
        .then(|| clue(50, "Windows", None, "ports 135 and 445 open".to_string()))
}

fn from_vendor(vendor: &str) -> Option<Clue> {
    if vendor.contains("Apple") {
        return Some(clue(
            40,
            "macOS or iOS",
            None,
            format!("MAC vendor: {vendor}"),
        ));
    }
    if vendor.contains("Raspberry Pi") {
        return Some(clue(
            40,
            "Linux",
            Some("Raspberry Pi OS"),
            format!("MAC vendor: {vendor}"),
        ));
    }
    None
}

fn from_ttl(ttl: u8) -> Option<Clue> {
    let family = match ttl {
        0 => return None,
        1..=64 => "Unix-like",
        65..=128 => "Windows",
        _ => "Network device",
    };
    Some(clue(20, family, None, format!("TTL {ttl}")))
}

#[cfg(test)]
mod tests;
