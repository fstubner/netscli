use hickory_resolver::proto::rr::RecordType;

pub(super) const ALL_RECORD_TYPES: &[RecordType] = &[
    RecordType::A,
    RecordType::AAAA,
    RecordType::CNAME,
    RecordType::MX,
    RecordType::NS,
    RecordType::TXT,
    RecordType::SRV,
    RecordType::PTR,
    RecordType::SOA,
    RecordType::CAA,
];

pub fn parse_record_type(value: &str) -> Option<RecordType> {
    match value.trim().to_uppercase().as_str() {
        "A" => Some(RecordType::A),
        "AAAA" => Some(RecordType::AAAA),
        "CNAME" => Some(RecordType::CNAME),
        "MX" => Some(RecordType::MX),
        "NS" => Some(RecordType::NS),
        "TXT" => Some(RecordType::TXT),
        "SRV" => Some(RecordType::SRV),
        "PTR" => Some(RecordType::PTR),
        "SOA" => Some(RecordType::SOA),
        "CAA" => Some(RecordType::CAA),
        _ => None,
    }
}

/// Normalize a raw `RData.to_string()` value for display.
///
/// The hickory resolver prints FQDNs with a trailing dot and wraps TXT values
/// in double quotes. Both are technically correct per the DNS wire format but
/// users expect `example.com` not `example.com.` and `v=spf1 -all` not
/// `"v=spf1 -all"`. We strip those for presentation.
pub(super) fn normalize_value(raw: &str) -> String {
    let s = raw.trim();
    // TXT values come back as `"chunk1" "chunk2"`; join into one string.
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        let inner = &s[1..s.len() - 1];
        // Collapse `" "` interior separators from multi-chunk TXT records.
        return inner.replace("\" \"", "");
    }
    // Strip a trailing FQDN dot but keep a lone "." (root) untouched.
    if s.len() > 1 && s.ends_with('.') {
        s.trim_end_matches('.').to_string()
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_value;

    #[test]
    fn normalize_value_strips_trailing_dot() {
        assert_eq!(normalize_value("example.com."), "example.com");
    }

    #[test]
    fn normalize_value_preserves_root_dot() {
        assert_eq!(normalize_value("."), ".");
    }

    #[test]
    fn normalize_value_unwraps_txt_quotes() {
        assert_eq!(normalize_value(r#""v=spf1 -all""#), "v=spf1 -all");
    }

    #[test]
    fn normalize_value_joins_multichunk_txt() {
        assert_eq!(normalize_value(r#""chunk1" "chunk2""#), "chunk1chunk2");
    }

    #[test]
    fn normalize_value_untouched_for_plain_a() {
        assert_eq!(normalize_value("192.0.2.1"), "192.0.2.1");
    }
}
