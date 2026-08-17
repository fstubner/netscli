//! Tests for the port parser and its limits.
//!
//! Split from `mod.rs` to keep that file under the 300-line guard: the
//! parsing logic is ~150 lines and the cases covering it are longer than
//! the code, which is the right ratio for input validation on a security
//! tool and the wrong reason to shorten either.

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
