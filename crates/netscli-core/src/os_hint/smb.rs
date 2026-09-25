//! What a Windows (or Samba) host says about itself over SMB before anyone
//! logs in.
//!
//! An SMB2 session setup starts with NTLM authentication. The client's first
//! message only lists what it supports; the server's reply, the NTLM
//! CHALLENGE, carries the server's OS version (major, minor, build) and its
//! NetBIOS and DNS names. That exchange is where this stops: no credentials
//! are sent and no session is created, the same two round trips any SMB
//! client makes before it asks for a password.
//!
//! Packets follow [MS-SMB2] 2.2.3 (NEGOTIATE), 2.2.5 (SESSION_SETUP) and
//! [MS-NLMP] 2.2.1.1 (NEGOTIATE_MESSAGE) / 2.2.1.2 (CHALLENGE_MESSAGE), with
//! the NTLM token wrapped in SPNEGO as Windows clients send it.

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

/// What the NTLM CHALLENGE said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SmbInfo {
    pub(crate) major: u8,
    pub(crate) minor: u8,
    pub(crate) build: u16,
    /// The NetBIOS computer name, when the server gave one.
    pub(crate) computer: Option<String>,
}

/// Ask the SMB server on `ip:445` for its NTLM challenge. `None` when
/// nothing listens, the server isn't SMB2, or it answers in a way this
/// doesn't recognise.
pub(crate) async fn query(ip: IpAddr, wait: Duration) -> Option<SmbInfo> {
    let exchange = async {
        let mut stream = TcpStream::connect(SocketAddr::new(ip, 445)).await.ok()?;
        stream.write_all(&negotiate_request()).await.ok()?;
        read_message(&mut stream).await?;
        stream.write_all(&session_setup_request()).await.ok()?;
        let reply = read_message(&mut stream).await?;
        parse_challenge(&reply)
    };
    timeout(wait, exchange).await.ok()?
}

/// One NetBIOS-framed SMB message: a zero byte, a 24-bit length, the body.
async fn read_message(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let mut header = [0u8; 4];
    stream.read_exact(&mut header).await.ok()?;
    let length =
        usize::from(header[1]) << 16 | usize::from(header[2]) << 8 | usize::from(header[3]);
    if header[0] != 0 || length > 64 * 1024 {
        return None;
    }
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body).await.ok()?;
    Some(body)
}

fn frame(body: Vec<u8>) -> Vec<u8> {
    let length = body.len();
    let mut out = vec![0, (length >> 16) as u8, (length >> 8) as u8, length as u8];
    out.extend(body);
    out
}

/// The 64-byte SMB2 header for `command` with message id `message_id`.
fn smb2_header(command: u16, message_id: u64) -> Vec<u8> {
    let mut h = Vec::with_capacity(64);
    h.extend_from_slice(b"\xfeSMB");
    h.extend_from_slice(&64u16.to_le_bytes()); // structure size
    h.extend_from_slice(&0u16.to_le_bytes()); // credit charge
    h.extend_from_slice(&0u32.to_le_bytes()); // status
    h.extend_from_slice(&command.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes()); // credits requested
    h.extend_from_slice(&0u32.to_le_bytes()); // flags
    h.extend_from_slice(&0u32.to_le_bytes()); // next command
    h.extend_from_slice(&message_id.to_le_bytes());
    h.extend_from_slice(&0u32.to_le_bytes()); // process id
    h.extend_from_slice(&0u32.to_le_bytes()); // tree id
    h.extend_from_slice(&0u64.to_le_bytes()); // session id
    h.extend_from_slice(&[0u8; 16]); // signature
    h
}

/// NEGOTIATE offering SMB 2.0.2, 2.1 and 3.0. 3.1.1 is left out because it
/// requires negotiate contexts, and the three offered are enough to reach
/// session setup on every Windows version and on Samba.
fn negotiate_request() -> Vec<u8> {
    const DIALECTS: [u16; 3] = [0x0202, 0x0210, 0x0300];
    let mut body = smb2_header(0x0000, 0);
    body.extend_from_slice(&36u16.to_le_bytes()); // structure size
    body.extend_from_slice(&(DIALECTS.len() as u16).to_le_bytes());
    body.extend_from_slice(&1u16.to_le_bytes()); // security mode: signing enabled
    body.extend_from_slice(&0u16.to_le_bytes()); // reserved
    body.extend_from_slice(&0u32.to_le_bytes()); // capabilities
    body.extend_from_slice(b"netscli-os-hint!"); // client guid, 16 bytes
    body.extend_from_slice(&0u64.to_le_bytes()); // client start time
    for dialect in DIALECTS {
        body.extend_from_slice(&dialect.to_le_bytes());
    }
    frame(body)
}

/// SESSION_SETUP carrying an NTLM NEGOTIATE_MESSAGE inside SPNEGO.
fn session_setup_request() -> Vec<u8> {
    let token = spnego_init(&ntlm_negotiate());
    let mut body = smb2_header(0x0001, 1);
    body.extend_from_slice(&25u16.to_le_bytes()); // structure size
    body.push(0); // flags
    body.push(1); // security mode: signing enabled
    body.extend_from_slice(&0u32.to_le_bytes()); // capabilities
    body.extend_from_slice(&0u32.to_le_bytes()); // channel
    body.extend_from_slice(&(64u16 + 24).to_le_bytes()); // security buffer offset
    body.extend_from_slice(&(token.len() as u16).to_le_bytes());
    body.extend_from_slice(&0u64.to_le_bytes()); // previous session id
    body.extend(token);
    frame(body)
}

/// An NTLM NEGOTIATE_MESSAGE asking for target info and the server's
/// version (NEGOTIATE_VERSION), with no domain or workstation.
fn ntlm_negotiate() -> Vec<u8> {
    const FLAGS: u32 = 0x0000_0001 // UNICODE
        | 0x0000_0004 // REQUEST_TARGET
        | 0x0000_0200 // NTLM
        | 0x0000_8000 // ALWAYS_SIGN
        | 0x0008_0000 // EXTENDED_SESSIONSECURITY
        | 0x0080_0000 // TARGET_INFO
        | 0x0200_0000 // VERSION
        | 0x2000_0000 // 128
        | 0x8000_0000; // 56
    let mut m = Vec::with_capacity(40);
    m.extend_from_slice(b"NTLMSSP\0");
    m.extend_from_slice(&1u32.to_le_bytes()); // NEGOTIATE_MESSAGE
    m.extend_from_slice(&FLAGS.to_le_bytes());
    m.extend_from_slice(&[0u8; 8]); // domain name fields
    m.extend_from_slice(&[0u8; 8]); // workstation fields
    m.extend_from_slice(&[10, 0, 0, 0, 0, 0, 0, 15]); // client version, NTLM revision 15
    m
}

/// DER: tag, short-form length, content. Every piece here is under 128
/// bytes, which is all the short form covers.
fn der(tag: u8, content: &[u8]) -> Vec<u8> {
    debug_assert!(content.len() < 128);
    let mut out = vec![tag, content.len() as u8];
    out.extend_from_slice(content);
    out
}

/// A SPNEGO NegTokenInit offering NTLMSSP, carrying `mech_token`.
fn spnego_init(mech_token: &[u8]) -> Vec<u8> {
    const SPNEGO_OID: &[u8] = &[0x2b, 0x06, 0x01, 0x05, 0x05, 0x02];
    const NTLMSSP_OID: &[u8] = &[0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x02, 0x02, 0x0a];
    let mech_types = der(0xa0, &der(0x30, &der(0x06, NTLMSSP_OID)));
    let token = der(0xa2, &der(0x04, mech_token));
    let init = der(0xa0, &der(0x30, &[mech_types, token].concat()));
    der(0x60, &[der(0x06, SPNEGO_OID), init].concat())
}

/// Find the NTLM CHALLENGE_MESSAGE in a SESSION_SETUP reply and read the
/// version and computer name from it.
///
/// The message sits inside a SPNEGO NegTokenResp inside the SMB2 body;
/// rather than decode those layers, this finds the `NTLMSSP\0` signature
/// followed by message type 2 and bounds-checks every read from there.
fn parse_challenge(reply: &[u8]) -> Option<SmbInfo> {
    let at = reply
        .windows(12)
        .position(|w| &w[..8] == b"NTLMSSP\0" && w[8..12] == 2u32.to_le_bytes())?;
    let m = &reply[at..];
    let u16_at = |i: usize| Some(u16::from_le_bytes(m.get(i..i + 2)?.try_into().ok()?));
    let u32_at = |i: usize| Some(u32::from_le_bytes(m.get(i..i + 4)?.try_into().ok()?));

    let flags = u32_at(20)?;
    if flags & 0x0200_0000 == 0 {
        return None; // the server didn't include its version
    }
    let version = m.get(48..52)?;
    let (major, minor, build) = (
        version[0],
        version[1],
        u16::from_le_bytes([version[2], version[3]]),
    );

    let info_len = usize::from(u16_at(40)?);
    let info_at = u32_at(44)? as usize;
    let info = m
        .get(info_at..info_at.checked_add(info_len)?)
        .unwrap_or(&[]);
    Some(SmbInfo {
        major,
        minor,
        build,
        computer: netbios_computer_name(info),
    })
}

/// MsvAvNbComputerName (AvId 1) from an NTLM target-info block of AV pairs.
fn netbios_computer_name(mut info: &[u8]) -> Option<String> {
    while info.len() >= 4 {
        let id = u16::from_le_bytes([info[0], info[1]]);
        let len = usize::from(u16::from_le_bytes([info[2], info[3]]));
        let value = info.get(4..4 + len)?;
        match id {
            0 => return None,
            1 => {
                let units: Vec<u16> = value
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                let name: String = String::from_utf16_lossy(&units)
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(32)
                    .collect();
                return (!name.is_empty()).then_some(name);
            }
            _ => info = &info[4 + len..],
        }
    }
    None
}

#[cfg(test)]
mod tests;
