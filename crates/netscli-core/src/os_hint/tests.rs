use super::*;
use crate::scan::{HttpHeader, HttpProbe, PortStatus};

fn open_port(port: u16, banner: Option<&str>, server: Option<&str>) -> PortResult {
    let mut result = PortResult::new(port, PortStatus::Open, None);
    result.banner = banner.map(str::to_string);
    result.http = server.map(|value| HttpProbe {
        status_line: Some("HTTP/1.1 200 OK".to_string()),
        headers: vec![HttpHeader {
            name: "Server".to_string(),
            value: value.to_string(),
        }],
    });
    result
}

fn clues<'a>(ports: &'a [PortResult]) -> Clues<'a> {
    Clues {
        ttl: None,
        ports,
        vendor: None,
        smb: None,
    }
}

#[test]
fn smb_names_the_exact_windows_build() {
    let smb = SmbInfo {
        major: 10,
        minor: 0,
        build: 26100,
        computer: Some("OFFICE-PC".to_string()),
    };
    let hint = hint(&Clues {
        ttl: Some(128),
        smb: Some(&smb),
        ..clues(&[])
    })
    .unwrap();
    assert_eq!(hint.family, "Windows");
    assert_eq!(
        hint.detail.as_deref(),
        Some("Windows 11 or Server 2025 (build 26100)")
    );
    assert_eq!(
        hint.evidence,
        vec!["SMB: Windows 10.0 build 26100, name OFFICE-PC", "TTL 128"]
    );
}

#[test]
fn an_ssh_banner_names_the_distribution() {
    let ports = [open_port(
        22,
        Some("SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.19"),
        None,
    )];
    let hint = hint(&Clues {
        ttl: Some(64),
        ..clues(&ports)
    })
    .unwrap();
    assert_eq!(hint.family, "Linux");
    assert_eq!(hint.detail.as_deref(), Some("Ubuntu"));
    assert_eq!(hint.evidence, vec!["SSH banner: Ubuntu", "TTL 64"]);
}

#[test]
fn web_server_headers_and_windows_ports_count() {
    let ports = [open_port(80, None, Some("Microsoft-IIS/10.0"))];
    assert_eq!(hint(&clues(&ports)).unwrap().family, "Windows");
    let ports = [open_port(135, None, None), open_port(445, None, None)];
    assert_eq!(
        hint(&clues(&ports)).unwrap().evidence,
        vec!["ports 135 and 445 open"]
    );
}

#[test]
fn a_mac_vendor_or_ttl_alone_gives_a_weaker_family() {
    let apple = hint(&Clues {
        vendor: Some("Apple, Inc."),
        ..clues(&[])
    })
    .unwrap();
    assert_eq!(apple.family, "macOS or iOS");
    let router = hint(&Clues {
        ttl: Some(255),
        ..clues(&[])
    })
    .unwrap();
    assert_eq!(router.family, "Network device");
}

#[test]
fn the_strongest_clue_wins_and_a_disagreeing_one_is_still_shown() {
    // A Linux box whose ping reply looked Windows-like: the SSH banner
    // outranks the TTL, but the TTL stays in the evidence.
    let ports = [open_port(
        22,
        Some("SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u9"),
        None,
    )];
    let hint = hint(&Clues {
        ttl: Some(128),
        ..clues(&ports)
    })
    .unwrap();
    assert_eq!(hint.family, "Linux");
    assert_eq!(hint.evidence, vec!["SSH banner: Debian", "TTL 128"]);
}

#[test]
fn an_smb_server_without_a_windows_build_says_nothing() {
    let smb = SmbInfo {
        major: 6,
        minor: 1,
        build: 0,
        computer: None,
    };
    assert_eq!(
        hint(&Clues {
            smb: Some(&smb),
            ..clues(&[])
        }),
        None
    );
}

#[test]
fn no_clues_no_hint() {
    assert_eq!(hint(&clues(&[])), None);
}

#[test]
fn the_summary_names_the_family_unless_the_detail_already_does() {
    let hint = |family: &str, detail: Option<&str>| OsHint {
        family: family.to_string(),
        detail: detail.map(str::to_string),
        evidence: vec![],
    };
    assert_eq!(hint("Linux", Some("Debian")).summary(), "Linux, Debian");
    assert_eq!(
        hint("Windows", Some("Windows 11 or Server 2025 (build 26100)")).summary(),
        "Windows 11 or Server 2025 (build 26100)"
    );
    assert_eq!(hint("Unix-like", None).summary(), "Unix-like");
}
