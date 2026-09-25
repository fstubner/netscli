use super::*;

/// A CHALLENGE_MESSAGE as a Windows 11 24H2 host sends it, with some
/// bytes in front standing in for the SMB2 and SPNEGO layers.
fn challenge(version: [u8; 4], computer: &str, with_version_flag: bool) -> Vec<u8> {
    let name: Vec<u8> = computer.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut info = Vec::new();
    info.extend_from_slice(&2u16.to_le_bytes()); // NbDomainName first
    info.extend_from_slice(&8u16.to_le_bytes());
    info.extend("HOME".encode_utf16().flat_map(u16::to_le_bytes));
    info.extend_from_slice(&1u16.to_le_bytes());
    info.extend_from_slice(&(name.len() as u16).to_le_bytes());
    info.extend(&name);
    info.extend_from_slice(&[0, 0, 0, 0]); // MsvAvEOL

    let mut m = b"NTLMSSP\0".to_vec();
    m.extend_from_slice(&2u32.to_le_bytes());
    m.extend_from_slice(&[0u8; 8]); // target name fields
    let flags: u32 = if with_version_flag {
        0x0280_0215
    } else {
        0x0080_0215
    };
    m.extend_from_slice(&flags.to_le_bytes());
    m.extend_from_slice(&[0x11; 8]); // server challenge
    m.extend_from_slice(&[0u8; 8]); // reserved
    m.extend_from_slice(&(info.len() as u16).to_le_bytes());
    m.extend_from_slice(&(info.len() as u16).to_le_bytes());
    m.extend_from_slice(&56u32.to_le_bytes()); // target info offset
    m.extend_from_slice(&version);
    m.extend_from_slice(&[0, 0, 0, 15]);
    assert_eq!(m.len(), 56);
    m.extend(info);

    let mut reply = vec![0xa1, 0x81, 0x99, 0x30]; // stand-in SPNEGO bytes
    reply.extend(m);
    reply
}

#[test]
fn a_challenge_gives_the_windows_version_and_computer_name() {
    let build = 26100u16.to_le_bytes();
    let info = parse_challenge(&challenge([10, 0, build[0], build[1]], "OFFICE-PC", true));
    assert_eq!(
        info,
        Some(SmbInfo {
            major: 10,
            minor: 0,
            build: 26100,
            computer: Some("OFFICE-PC".to_string())
        })
    );
}

#[test]
fn a_challenge_without_a_version_gives_nothing() {
    assert_eq!(
        parse_challenge(&challenge([10, 0, 0, 0], "PC", false)),
        None
    );
    assert_eq!(parse_challenge(b"no ntlm here"), None);
}

#[test]
fn a_truncated_challenge_is_rejected_rather_than_read_past() {
    let full = challenge([10, 0, 0x74, 0x65], "PC", true);
    for cut in [12, 30, 50] {
        assert_eq!(parse_challenge(&full[..4 + cut]), None, "cut at {cut}");
    }
}

#[test]
fn a_hostile_computer_name_is_trimmed_to_plain_text() {
    let build = 19045u16.to_le_bytes();
    let info = parse_challenge(&challenge(
        [10, 0, build[0], build[1]],
        "EVIL\u{1b}[2J-NAME-THAT-GOES-ON-FOR-FAR-TOO-LONG",
        true,
    ))
    .unwrap();
    let name = info.computer.unwrap();
    assert!(!name.chars().any(char::is_control));
    assert!(name.chars().count() <= 32);
}

#[test]
fn requests_are_framed_and_well_formed() {
    let negotiate = negotiate_request();
    assert_eq!(negotiate[0], 0);
    assert_eq!(usize::from(negotiate[3]), negotiate.len() - 4);
    assert_eq!(&negotiate[4..8], b"\xfeSMB");
    let setup = session_setup_request();
    let body = &setup[4..];
    // The security buffer offset points at the SPNEGO token.
    assert_eq!(body[64 + 12], 88);
    assert_eq!(body[88], 0x60);
    assert!(body.windows(8).any(|w| w == b"NTLMSSP\0"));
}
