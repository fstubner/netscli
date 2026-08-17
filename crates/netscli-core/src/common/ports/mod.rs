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
mod tests;
