use std::collections::BTreeSet;

use super::constants::DEFAULT_PORTS;
use crate::error::{Error, Result};

pub const MAX_PORTS_PER_SCAN: usize = 4096;

/// Validate an already-parsed port list.
///
/// Lives here, next to `MAX_PORTS_PER_SCAN`, so every interface answers the
/// same way. The CLI and GUI reach it through `parse_ports_checked`; the MCP
/// server and any library consumer reach it through `Ops`, which validates
/// whatever it is handed rather than trusting the caller to have parsed it
/// from a string.
///
/// Port 0 is rejected. It is not a connectable TCP port — in a `bind` it
/// means "pick any free port", and in a `connect` it is meaningless. The MCP
/// server has always rejected it while the CLI happily reported
/// "Scanned 1 port (0 open)", which is the divergence this function exists
/// to remove.
pub fn validate_ports(ports: &[u16]) -> Result<()> {
    if ports.contains(&0) {
        return Err(Error::invalid_input(
            "port 0 is invalid (not a connectable TCP port)",
        ));
    }
    if ports.len() > MAX_PORTS_PER_SCAN {
        return Err(Error::invalid_input(format!(
            "too many ports requested ({} > {})",
            ports.len(),
            MAX_PORTS_PER_SCAN
        )));
    }
    Ok(())
}

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

    // Accumulate into a set, and check the cap *inside* the loop.
    //
    // This used to expand every token into one flat Vec, then sort, dedup
    // and validate at the end — so the 4,096-port cap could not prevent the
    // work it exists to prevent. `-p` is just a string, and each `1-65535`
    // token expands to 65,535 entries before anything looks at the total:
    // a 24 KB argument took **2m11s** to be rejected (measured, debug
    // build), and the cost is linear, so a 1 MB argument allocates tens of
    // gigabytes before erroring.
    //
    // A `BTreeSet` fixes both halves at once. Memory is bounded by the
    // 65,536 distinct ports that exist rather than by the input length, and
    // because the set is deduplicated as it grows, the length check after
    // each token is exact — a leading `1-65535` is rejected immediately.
    // Iterating a BTreeSet yields sorted unique values, so the explicit
    // sort+dedup this replaces is now free, and the returned list is
    // byte-for-byte what it was before.
    //
    // Residual: an input made entirely of *repeated identical* ranges
    // (`1-4096,1-4096,…`) never grows the set past the cap, so it is still
    // walked token by token. That is bounded work per token with no
    // allocation growth, which is a different order of problem from the one
    // above.
    let mut ports: BTreeSet<u16> = BTreeSet::new();
    for part in raw.split(',') {
        let expanded = parse_port_token(part).map_err(|e| {
            // Add the caller's context so consumers see both "why" and
            // "where" in one Error. Match on the variant rather than
            // formatting `e`, whose Display already carries an
            // "invalid input: " prefix — interpolating it produced
            // "invalid input: Invalid port list 'x': invalid input: …".
            let detail = match e {
                Error::InvalidInput(detail) => detail,
                other => other.to_string(),
            };
            Error::invalid_input(format!("invalid port list '{raw}': {detail}"))
        })?;
        ports.extend(expanded);
        if ports.len() > MAX_PORTS_PER_SCAN {
            // Delegate to validate_ports rather than restating the limit or
            // its wording here — one rule, one message, one place. It is
            // guaranteed to return Err given the length we just checked.
            let so_far: Vec<u16> = ports.iter().copied().collect();
            validate_ports(&so_far)?;
        }
    }
    if ports.is_empty() {
        return Err(Error::invalid_input(format!("invalid port list: {raw}")));
    }
    let ports: Vec<u16> = ports.into_iter().collect();
    // Propagate as-is rather than re-wrapping. `validate_ports` already
    // returns an `Error::InvalidInput` naming the offending rule, and
    // wrapping it in another one rendered as
    // "invalid input: Invalid port list '0': invalid input: port 0 is …".
    validate_ports(&ports)?;
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
        assert!(err.to_string().contains("invalid port list"));
    }

    #[test]
    fn test_parse_ports_checked_rejects_typo() {
        // Previously this silently returned [80,443]. Typos are now surfaced.
        let err = parse_ports_checked(Some("80,invalid,443")).unwrap_err();
        assert!(
            err.to_string().contains("invalid port list"),
            "expected strict rejection, got: {err}"
        );
    }

    #[test]
    fn test_parse_ports_checked_rejects_out_of_range() {
        let err = parse_ports_checked(Some("22,99999")).unwrap_err();
        assert!(err.to_string().contains("invalid port list"));
    }

    #[test]
    fn test_parse_ports_checked_rejects_inverted_range() {
        let err = parse_ports_checked(Some("90-80")).unwrap_err();
        assert!(err.to_string().contains("invalid port list"));
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

    // --- port 0 -----------------------------------------------------------
    // Regression: the CLI accepted `-p 0` and reported "Scanned 1 port
    // (0 open)" while the MCP server rejected the same input, because each
    // surface carried its own validation. These pin the single shared rule.

    #[test]
    fn validate_ports_rejects_port_zero() {
        assert!(validate_ports(&[0]).is_err());
        assert!(validate_ports(&[22, 0, 443]).is_err());
        assert!(validate_ports(&[22, 443]).is_ok());
    }

    #[test]
    fn validate_ports_enforces_the_scan_cap() {
        let ok: Vec<u16> = (1..=MAX_PORTS_PER_SCAN as u16).collect();
        assert!(validate_ports(&ok).is_ok());
        let too_many: Vec<u16> = (1..=(MAX_PORTS_PER_SCAN as u16 + 1)).collect();
        assert!(validate_ports(&too_many).is_err());
    }

    #[test]
    fn parse_ports_checked_rejects_port_zero() {
        for input in ["0", "0,80", "80,0", "0-2"] {
            let err = parse_ports_checked(Some(input))
                .unwrap_err()
                .to_string()
                .to_lowercase();
            assert!(err.contains("port 0"), "input {input:?} gave: {err}");
        }
    }

    #[test]
    fn parse_ports_checked_still_accepts_port_one() {
        // Guard against an off-by-one turning "reject 0" into "reject <2".
        assert_eq!(parse_ports_checked(Some("1")).unwrap(), Some(vec![1]));
        assert_eq!(
            parse_ports_checked(Some("1-3")).unwrap(),
            Some(vec![1, 2, 3])
        );
    }

    #[test]
    fn parse_ports_checked_rejects_an_oversized_list_without_expanding_it() {
        // The cap used to be checked only after the whole string had been
        // expanded, so it could not stop the allocation it exists to
        // prevent. Measured against the old code, this input took over two
        // minutes to be rejected; it now returns on the first token.
        //
        // The budget is deliberately loose. The point is the difference
        // between "immediate" and "minutes", not a precise timing, and a
        // loaded CI runner must not make this flaky.
        let big = "1-65535,".repeat(2000);
        let start = std::time::Instant::now();
        let err = parse_ports_checked(Some(&big)).unwrap_err().to_string();
        let elapsed = start.elapsed();

        assert!(err.contains("too many ports"), "unexpected error: {err}");
        assert!(
            elapsed < std::time::Duration::from_secs(10),
            "took {elapsed:?} to reject a list it could have rejected on the first token"
        );
    }

    #[test]
    fn parse_ports_checked_still_dedups_across_tokens() {
        // Switching to a set must not change the accepted/rejected line.
        // Overlapping ranges collapse, so this stays under the cap and is
        // still accepted, exactly as with the previous sort+dedup.
        let overlapping = format!("1-{MAX_PORTS_PER_SCAN},1-{MAX_PORTS_PER_SCAN}");
        let parsed = parse_ports_checked(Some(&overlapping)).unwrap().unwrap();
        assert_eq!(parsed.len(), MAX_PORTS_PER_SCAN);
        assert_eq!(parsed.first(), Some(&1));
        assert_eq!(parsed.last(), Some(&(MAX_PORTS_PER_SCAN as u16)));

        // And the ordinary case is still sorted and deduplicated.
        assert_eq!(
            parse_ports_checked(Some("443,22,80,22")).unwrap(),
            Some(vec![22, 80, 443])
        );
    }
}
