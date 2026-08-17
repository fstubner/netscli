use hickory_resolver::proto::rr::RData;
use std::net::IpAddr;
use std::time::Duration;
#[cfg(windows)]
use std::{process::Stdio, str::FromStr};
#[cfg(windows)]
use tokio::process::Command;
use tokio::time::timeout;

use super::resolver::shared_resolver;
use crate::error::{Error, Result};

pub async fn reverse_lookup_timeout(ip: IpAddr, timeout_ms: u64) -> Result<Option<String>> {
    let resolver = shared_resolver()?;
    let resp = match timeout(
        Duration::from_millis(timeout_ms),
        resolver.reverse_lookup(ip),
    )
    .await
    {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return Err(Error::dns(format!("reverse lookup failed: {e}"))),
        Err(_) => return Err(Error::Timeout(timeout_ms)),
    };
    // hickory 0.26: `Lookup` is now flat; extract the first PTR's Name
    // and convert to UTF-8 manually instead of `.iter().next().to_utf8()`.
    let name = resp.answers().iter().find_map(|r| match &r.data {
        RData::PTR(ptr) => Some(ptr.0.to_utf8()),
        _ => None,
    });
    Ok(name.filter(|s| !s.is_empty()))
}

/// Reverse-resolve an IP address to a hostname.
///
/// - On Windows, `ping -a` often resolves names via LLMNR/NetBIOS even when
///   no PTR records exist.
/// - On other platforms, this falls back to a DNS PTR lookup.
///
/// Both paths run their result through `normalize_hostname` so callers get
/// consistent output regardless of the OS we're on.
pub async fn reverse_lookup_best_effort_timeout(ip: IpAddr, timeout_ms: u64) -> Option<String> {
    #[cfg(windows)]
    if let Some(name) = reverse_lookup_windows_ping(ip, timeout_ms).await {
        if let Some(normalized) = normalize_hostname(name) {
            return Some(normalized);
        }
    }

    reverse_lookup_timeout(ip, timeout_ms)
        .await
        .ok()
        .flatten()
        .and_then(normalize_hostname)
}

/// Trim a resolved name, and reject one carrying a control character.
///
/// Every reverse-lookup result funnels through here, so this is the one
/// place that can guarantee the property for all consumers — plain-text
/// CLI, `--json`, the TUI, the desktop app and the MCP server alike.
///
/// It matters because of the Windows branch. [`reverse_lookup_windows_ping`]
/// lifts the name out of `ping -a` stdout, and `ping -a` resolves through
/// LLMNR and NetBIOS, where the name is whatever a device on the local link
/// decided to call itself — raw bytes, escaped by nothing. The whitespace
/// tokenisation there does not remove `ESC`, so a device naming itself
/// `\x1b[2K\x1b[1A` could repaint the row above its own in `netscli
/// discover --resolve` output and forge another host's line.
///
/// The pure-DNS path happens to be safe already: hickory's `Label` Display
/// octal-escapes control bytes. But that is a dependency's behaviour, not a
/// property this code holds, and it does not cover the Windows route.
///
/// Rejecting rather than sanitising: a hostname containing a control
/// character is malformed by any definition, so "no name resolved" is the
/// honest answer and leaves nothing mangled to display. Callers already
/// handle `None`.
fn normalize_hostname(name: String) -> Option<String> {
    let name = name.trim().trim_end_matches('.').trim();
    if name.is_empty() || name.chars().any(char::is_control) {
        None
    } else {
        Some(name.to_string())
    }
}

#[cfg(windows)]
async fn reverse_lookup_windows_ping(ip: IpAddr, timeout_ms: u64) -> Option<String> {
    // Only IPv4 is supported by the ping parsing below.
    if !matches!(ip, IpAddr::V4(_)) {
        return None;
    }

    let ip_s = ip.to_string();
    let wait_ms = timeout_ms.saturating_add(250);
    let mut cmd = Command::new("ping");
    cmd.args(["-a", "-n", "1", "-w", &timeout_ms.to_string(), &ip_s])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = match timeout(Duration::from_millis(wait_ms), cmd.output()).await {
        Ok(Ok(out)) => out,
        _ => return None,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Only scan the first few lines — `ping -a` emits the hostname in its
    // opening "Pinging <name> [<ip>] ..." banner. Later reply lines (e.g.
    // "Reply from 192.168.1.5: bytes=32 ..." on some locales) can also
    // contain `[ip]` and would otherwise misparse as a hostname.
    for line in stdout.lines().take(4) {
        if !line.contains('[') || !line.contains(']') {
            continue;
        }
        let Some(before) = line.split('[').next() else {
            continue;
        };
        let before = before.trim();

        // Take the last whitespace token before the "[ip]" segment as the
        // candidate hostname. This is locale-tolerant: English "Pinging X [ip]",
        // Spanish "Haciendo ping a X [ip] con 32 ...", etc.
        let Some(candidate) = before.split_whitespace().last() else {
            continue;
        };
        let candidate = candidate.trim().trim_end_matches('.');
        if candidate.is_empty() {
            continue;
        }

        // If the "hostname" is actually just the IP literal, there was no
        // reverse-resolution — fall through to PTR lookup.
        if IpAddr::from_str(candidate).is_ok() {
            return None;
        }

        return Some(candidate.to_string());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::normalize_hostname;

    #[test]
    fn normalize_hostname_drops_trailing_dot_and_ws() {
        assert_eq!(
            normalize_hostname("host.example.com.".to_string()),
            Some("host.example.com".to_string())
        );
        assert_eq!(
            normalize_hostname("  host.example.com  ".to_string()),
            Some("host.example.com".to_string())
        );
    }

    #[test]
    fn normalize_hostname_rejects_empty() {
        assert_eq!(normalize_hostname("".to_string()), None);
        assert_eq!(normalize_hostname(".".to_string()), None);
    }

    #[test]
    fn normalize_hostname_rejects_control_characters() {
        // The Windows `ping -a` route returns LLMNR/NetBIOS names as raw
        // bytes. A device that names itself with a cursor-up plus
        // line-erase can repaint the row above its own in `discover
        // --resolve` output, forging another host's line.
        assert_eq!(normalize_hostname("\u{1b}[2K\u{1b}[1A".to_string()), None);
        assert_eq!(normalize_hostname("evil\u{1b}[31mhost".to_string()), None);
        // OSC 52 writes the operator's clipboard; it needs the BEL too.
        assert_eq!(
            normalize_hostname("host\u{1b}]52;c;cHduZWQK\u{7}".to_string()),
            None
        );
        // A bare newline would fabricate an extra output line.
        assert_eq!(normalize_hostname("real\nfake".to_string()), None);
    }

    #[test]
    fn normalize_hostname_keeps_legitimate_unicode() {
        // Rejecting control characters must not reject IDN hostnames.
        assert_eq!(
            normalize_hostname("münchen.example.com".to_string()),
            Some("münchen.example.com".to_string())
        );
    }
}
