//! Product and version from what an open port has already said.
//!
//! No extra probes: this reads the SSH identification line, an HTTP `Server`
//! header, or an FTP/SMTP/IMAP/POP greeting that the scan collected anyway,
//! and pulls out the software and its version where the service states them
//! (`OpenSSH` `9.6p1`, `nginx` `1.25.3`). A service that names itself without
//! a version (`cloudflare`, Postfix) gets a product and no version.
//!
//! This is deliberately smaller than nmap's `-sV`, which sends thousands of
//! probes from a database under nmap's own licence. What a service announces
//! unprompted covers the common cases on a LAN -- SSH, web servers, mail and
//! FTP -- and costs nothing extra on the wire.
//!
//! Everything here is text the scanned host chose. Products and versions are
//! capped in length and restricted to the characters a version string uses, so
//! a hostile greeting can't put anything else into those two fields.

use super::types::PortResult;

/// Longest product name kept. Real ones are short (`Microsoft-IIS`,
/// `FileZilla Server`); anything longer is not a product name.
const MAX_PRODUCT: usize = 40;
/// Longest version kept (`8.17.1/8.17.1` is about the longest real one).
const MAX_VERSION: usize = 32;

/// Greetings that name their software, in the spelling to report it with.
/// Each is looked for case-insensitively in the first line of the greeting,
/// and the token after it is the version if it starts with a digit.
const GREETING_PRODUCTS: &[&str] = &[
    "vsFTPd",
    "ProFTPD",
    "Pure-FTPd",
    "FileZilla Server",
    "Microsoft FTP Service",
    "Exim",
    "Sendmail",
    "Postfix",
    "OpenSMTPD",
    "Dovecot",
    "Courier",
    "Cyrus",
];

/// The product and version an open port announced, if it named itself.
pub(super) fn identify(result: &PortResult) -> Option<(String, Option<String>)> {
    if let Some(http) = &result.http {
        let server = http
            .headers
            .iter()
            .find(|header| header.name.eq_ignore_ascii_case("server"))?;
        return from_server_header(&server.value);
    }
    let first_line = result.raw.as_deref()?.lines().next()?.trim();
    from_ssh_line(first_line).or_else(|| from_greeting(first_line))
}

/// `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13` -> `OpenSSH`, `9.6p1`.
///
/// RFC 4253 puts the software after the protocol version, and most servers
/// write it as `name_version`. A few use `name-version` (`Cisco-1.25`), and
/// some give a name only.
fn from_ssh_line(line: &str) -> Option<(String, Option<String>)> {
    let rest = line.strip_prefix("SSH-")?;
    let (_protocol, software) = rest.split_once('-')?;
    let software = software.split_whitespace().next()?;
    let (name, version) = match software.split_once('_') {
        Some((name, version)) => (name, Some(version)),
        None => match software.rsplit_once('-') {
            Some((name, version)) if starts_with_digit(version) => (name, Some(version)),
            _ => (software, None),
        },
    };
    product_and_version(name, version)
}

/// `Apache/2.4.58 (Ubuntu) OpenSSL/3.0.13` -> `Apache`, `2.4.58`.
///
/// The first product token is the server itself; the ones after it are
/// modules and libraries. `cloudflare` has no version.
fn from_server_header(value: &str) -> Option<(String, Option<String>)> {
    let first = value.split_whitespace().next()?;
    match first.split_once('/') {
        Some((name, version)) => product_and_version(name, Some(version)),
        None => product_and_version(first, None),
    }
}

/// `220 (vsFTPd 3.0.5)` -> `vsFTPd`, `3.0.5`; `220 mx ESMTP Postfix` ->
/// `Postfix`, no version; `* OK Dovecot ready.` -> `Dovecot`.
fn from_greeting(line: &str) -> Option<(String, Option<String>)> {
    // Only a line shaped like a greeting: FTP and SMTP open with `220`, IMAP
    // with `* OK`, POP3 with `+OK`. Anything else that happens to contain
    // "courier" is not a mail server announcing itself.
    let is_greeting = ["220", "* OK", "+OK"].iter().any(|p| line.starts_with(p));
    if !is_greeting {
        return None;
    }
    let lower = line.to_ascii_lowercase();
    GREETING_PRODUCTS.iter().find_map(|&product| {
        let at = lower.find(&product.to_ascii_lowercase())?;
        let after = &line[at + product.len()..];
        let version = after
            .split_whitespace()
            .next()
            .filter(|t| starts_with_digit(t));
        product_and_version(product, version)
    })
}

/// Validate and tidy what a parser found. A product must be a short run of
/// ordinary characters; a version must start with a digit, and loses any
/// trailing punctuation from the sentence around it (`3.0.5)` -> `3.0.5`).
fn product_and_version(name: &str, version: Option<&str>) -> Option<(String, Option<String>)> {
    let name = name.trim();
    let name_ok = !name.is_empty()
        && name.len() <= MAX_PRODUCT
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '));
    if !name_ok {
        return None;
    }
    let version = version
        .map(|v| {
            v.trim_end_matches(|c: char| !c.is_ascii_alphanumeric())
                .to_string()
        })
        .filter(|v| {
            starts_with_digit(v)
                && v.len() <= MAX_VERSION
                && v.chars().all(|c| {
                    c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+' | '~' | '/')
                })
        });
    Some((name.to_string(), version))
}

fn starts_with_digit(text: &str) -> bool {
    text.chars().next().is_some_and(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::types::{HttpHeader, HttpProbe, PortStatus};

    fn greeting(raw: &str) -> PortResult {
        let mut result = PortResult::new(22, PortStatus::Open, None);
        result.raw = Some(raw.to_string());
        result
    }

    fn web(server: &str) -> PortResult {
        let mut result = PortResult::new(80, PortStatus::Open, None);
        result.http = Some(HttpProbe {
            status_line: Some("HTTP/1.1 200 OK".to_string()),
            headers: vec![HttpHeader {
                name: "Server".to_string(),
                value: server.to_string(),
            }],
        });
        result
    }

    fn found(product: &str, version: Option<&str>) -> Option<(String, Option<String>)> {
        Some((product.to_string(), version.map(str::to_string)))
    }

    #[test]
    fn ssh_servers_name_their_software() {
        assert_eq!(
            identify(&greeting("SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13\r\n")),
            found("OpenSSH", Some("9.6p1"))
        );
        assert_eq!(
            identify(&greeting("SSH-2.0-dropbear_2022.83\r\n")),
            found("dropbear", Some("2022.83"))
        );
        assert_eq!(
            identify(&greeting("SSH-2.0-Cisco-1.25\r\n")),
            found("Cisco", Some("1.25"))
        );
        assert_eq!(
            identify(&greeting("SSH-2.0-RomSShell\r\n")),
            found("RomSShell", None)
        );
    }

    #[test]
    fn web_servers_are_read_from_the_server_header() {
        assert_eq!(
            identify(&web("nginx/1.25.3")),
            found("nginx", Some("1.25.3"))
        );
        assert_eq!(
            identify(&web("Apache/2.4.58 (Ubuntu) OpenSSL/3.0.13")),
            found("Apache", Some("2.4.58"))
        );
        assert_eq!(
            identify(&web("Microsoft-IIS/10.0")),
            found("Microsoft-IIS", Some("10.0"))
        );
        assert_eq!(identify(&web("cloudflare")), found("cloudflare", None));
    }

    #[test]
    fn mail_and_ftp_greetings_name_their_software() {
        assert_eq!(
            identify(&greeting("220 (vsFTPd 3.0.5)\r\n")),
            found("vsFTPd", Some("3.0.5"))
        );
        assert_eq!(
            identify(&greeting(
                "220 mail.example.com ESMTP Exim 4.96 Thu, 24 Sep 2026\r\n"
            )),
            found("Exim", Some("4.96"))
        );
        assert_eq!(
            identify(&greeting("220 mx.example.com ESMTP Postfix (Ubuntu)\r\n")),
            found("Postfix", None)
        );
    }

    #[test]
    fn a_service_that_does_not_name_itself_gets_nothing() {
        assert_eq!(identify(&greeting("+OK ready\r\n")), None);
        // Names a product, but isn't a greeting.
        assert_eq!(identify(&greeting("Courier delivery status: ok\r\n")), None);
        assert_eq!(
            identify(&PortResult::new(3389, PortStatus::Open, None)),
            None
        );
    }

    #[test]
    fn a_hostile_greeting_cannot_fill_the_fields_with_anything_else() {
        // Not a plausible product name: rejected outright.
        assert_eq!(
            identify(&greeting("SSH-2.0-<script>alert(1)</script>_1.0\r\n")),
            None
        );
        // A version has to look like one, and is capped.
        assert_eq!(
            identify(&greeting(&format!(
                "SSH-2.0-OpenSSH_{}\r\n",
                "9".repeat(100)
            ))),
            found("OpenSSH", None)
        );
        assert_eq!(identify(&web("nginx/$(reboot)")), found("nginx", None));
    }
}
