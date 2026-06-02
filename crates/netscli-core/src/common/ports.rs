use super::constants::DEFAULT_PORTS;
use crate::error::{Error, Result};

pub const MAX_PORTS_PER_SCAN: usize = 4096;

/// Lenient parser used by internal defaults — silently drops invalid tokens.
/// Prefer `parse_ports_checked` for user input so typos are surfaced.
pub fn parse_ports(input: Option<&str>) -> Option<Vec<u16>> {
    input.map(|s| {
        s.split(',')
            .filter_map(|part| parse_port_token(part).ok())
            .flatten()
            .collect()
    })
}

fn parse_port_token(part: &str) -> Result<Vec<u16>> {
    let part = part.trim();
    if part.is_empty() {
        return Ok(Vec::new());
    }

    if let Some((start, end)) = part.split_once('-') {
        let start_trim = start.trim();
        let end_trim = end.trim();
        let s: u16 = start_trim
            .parse()
            .map_err(|_| Error::invalid_input(format!("invalid port in range: '{start_trim}'")))?;
        let e: u16 = end_trim
            .parse()
            .map_err(|_| Error::invalid_input(format!("invalid port in range: '{end_trim}'")))?;
        if s > e {
            return Err(Error::invalid_input(format!(
                "inverted port range: {s}-{e}"
            )));
        }
        Ok((s..=e).collect())
    } else {
        let port: u16 = part
            .parse()
            .map_err(|_| Error::invalid_input(format!("invalid port: '{part}'")))?;
        Ok(vec![port])
    }
}

/// Strict parser for user input — rejects any malformed token instead of
/// silently discarding it. `Some(None)` means the input was absent/empty;
/// `Err(Error::InvalidInput(..))` means the user typed something that
/// couldn't be interpreted.
pub fn parse_ports_checked(input: Option<&str>) -> Result<Option<Vec<u16>>> {
    let Some(raw) = input else {
        return Ok(None);
    };

    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }

    let mut ports = Vec::new();
    for part in raw.split(',') {
        let mut expanded = parse_port_token(part).map_err(|e| {
            // Wrap the inner parser's per-token message with the caller's
            // context so consumers see both "why" and "where" in one Error.
            Error::invalid_input(format!("Invalid port list '{raw}': {e}"))
        })?;
        ports.append(&mut expanded);
    }
    if ports.is_empty() {
        return Err(Error::invalid_input(format!("Invalid port list: {raw}")));
    }
    // Sort + dedup so downstream scanners don't probe the same port twice.
    ports.sort_unstable();
    ports.dedup();
    if ports.len() > MAX_PORTS_PER_SCAN {
        return Err(Error::invalid_input(format!(
            "too many ports requested ({} > {})",
            ports.len(),
            MAX_PORTS_PER_SCAN
        )));
    }
    Ok(Some(ports))
}

pub fn default_ports() -> Vec<u16> {
    DEFAULT_PORTS.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ports_single() {
        assert_eq!(parse_ports(Some("80")), Some(vec![80]));
        assert_eq!(parse_ports(Some("443")), Some(vec![443]));
    }

    #[test]
    fn test_parse_ports_comma_separated() {
        assert_eq!(parse_ports(Some("80,443,8080")), Some(vec![80, 443, 8080]));
        assert_eq!(parse_ports(Some("22,80,443")), Some(vec![22, 80, 443]));
    }

    #[test]
    fn test_parse_ports_range() {
        assert_eq!(parse_ports(Some("80-82")), Some(vec![80, 81, 82]));
        assert_eq!(parse_ports(Some("22-24")), Some(vec![22, 23, 24]));
    }

    #[test]
    fn test_parse_ports_mixed() {
        assert_eq!(
            parse_ports(Some("80,443,8080-8082")),
            Some(vec![80, 443, 8080, 8081, 8082])
        );
    }

    #[test]
    fn test_parse_ports_with_spaces() {
        assert_eq!(
            parse_ports(Some("80, 443, 8080")),
            Some(vec![80, 443, 8080])
        );
        assert_eq!(parse_ports(Some("80 - 82")), Some(vec![80, 81, 82]));
    }

    #[test]
    fn test_parse_ports_none() {
        assert_eq!(parse_ports(None), None);
    }

    #[test]
    fn test_parse_ports_invalid_lenient() {
        // Lenient `parse_ports` silently drops invalid tokens — that's
        // intentional for internal defaults. User input goes through
        // `parse_ports_checked` which is strict.
        assert_eq!(parse_ports(Some("invalid")), Some(vec![]));
        assert_eq!(parse_ports(Some("80,invalid,443")), Some(vec![80, 443]));
    }

    #[test]
    fn test_parse_ports_checked_invalid() {
        let err = parse_ports_checked(Some("invalid")).unwrap_err();
        assert!(err.to_string().contains("Invalid port list"));
    }

    #[test]
    fn test_parse_ports_checked_rejects_typo() {
        // Previously this silently returned [80,443]. Typos are now surfaced.
        let err = parse_ports_checked(Some("80,invalid,443")).unwrap_err();
        assert!(
            err.to_string().contains("Invalid port list"),
            "expected strict rejection, got: {err}"
        );
    }

    #[test]
    fn test_parse_ports_checked_rejects_out_of_range() {
        let err = parse_ports_checked(Some("22,99999")).unwrap_err();
        assert!(err.to_string().contains("Invalid port list"));
    }

    #[test]
    fn test_parse_ports_checked_rejects_inverted_range() {
        let err = parse_ports_checked(Some("90-80")).unwrap_err();
        assert!(err.to_string().contains("Invalid port list"));
    }

    #[test]
    fn test_parse_ports_checked_enforces_scan_limit() {
        let ports = parse_ports_checked(Some("1-4096")).unwrap().unwrap();
        assert_eq!(ports.len(), MAX_PORTS_PER_SCAN);

        let err = parse_ports_checked(Some("1-4097")).unwrap_err();
        assert!(err.to_string().contains("too many ports requested"));
    }

    #[test]
    fn test_parse_ports_checked_empty() {
        assert_eq!(parse_ports_checked(Some("  ")).unwrap(), None);
    }

    #[test]
    fn test_parse_ports_checked_sorts_and_dedupes() {
        assert_eq!(
            parse_ports_checked(Some("443,80,22,80,22")).unwrap(),
            Some(vec![22, 80, 443])
        );
    }

    #[test]
    fn test_parse_ports_checked_valid() {
        assert_eq!(
            parse_ports_checked(Some("80,443")).unwrap(),
            Some(vec![80, 443])
        );
    }
}
