use once_cell::sync::OnceCell;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

static OUI_MAP: OnceCell<HashMap<String, String>> = OnceCell::new();

// Embedded copy of the vendor DB that ships inside the crate, so
// `cargo install netscli` and release binaries without a data/ dir
// next to them still get working vendor lookups. Overridable via
// NETSCLI_OUI_PATH or any of the on-disk candidates below.
const EMBEDDED_OUI: &[u8] = include_bytes!("../data/oui.min.json.gz");

pub fn lookup_vendor(mac: &str) -> Option<String> {
    let map = OUI_MAP.get_or_init(load_oui);
    let prefix = oui_prefix(mac)?;
    map.get(&prefix).cloned()
}

/// First 6 hex digits of a MAC, uppercased, separators removed.
///
/// Takes the first 6 *characters*, not the first 6 bytes. This is public
/// API, so a caller can hand us anything: `&key[..6]` panicked whenever
/// byte 6 landed mid-codepoint (e.g. "aabbc€", where € occupies bytes
/// 5..8). Returns `None` for anything that isn't at least 6 hex digits,
/// which also rejects the non-MAC input that used to reach the map
/// lookup.
fn oui_prefix(mac: &str) -> Option<String> {
    let prefix: String = mac
        .chars()
        .filter(|c| !matches!(c, ':' | '-' | '.'))
        .take(6)
        .collect();

    if prefix.chars().count() == 6 && prefix.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(prefix.to_ascii_uppercase())
    } else {
        None
    }
}

fn load_oui() -> HashMap<String, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(path) = std::env::var("NETSCLI_OUI_PATH") {
        candidates.push(PathBuf::from(path));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("oui.min.json.gz"));
            candidates.push(dir.join("oui.json"));
            candidates.push(dir.join("data").join("oui.min.json.gz"));
            candidates.push(dir.join("data").join("oui.json"));
        }
    }

    candidates.push(PathBuf::from("data/oui.min.json.gz"));
    candidates.push(PathBuf::from("data/oui.json"));

    for cand in &candidates {
        if let Some(map) = read_map(cand) {
            return map;
        }
    }

    // No disk copy found. Fall through to the embedded copy so
    // `cargo install` users still get working vendor lookups.
    parse_gz(EMBEDDED_OUI).unwrap_or_default()
}

fn read_map(path: &Path) -> Option<HashMap<String, String>> {
    let is_gz = path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gz"));

    if is_gz {
        let bytes = fs::read(path).ok()?;
        parse_gz(&bytes)
    } else {
        let data = fs::read_to_string(path).ok()?;
        parse_json(&data)
    }
}

fn parse_gz(bytes: &[u8]) -> Option<HashMap<String, String>> {
    let mut decoder = flate2::read::GzDecoder::new(bytes);
    let mut buf = String::new();
    decoder.read_to_string(&mut buf).ok()?;
    parse_json(&buf)
}

fn parse_json(data: &str) -> Option<HashMap<String, String>> {
    let json: Value = serde_json::from_str(data).ok()?;
    let mut map = HashMap::new();
    if let Some(obj) = json.as_object() {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                // Same char-vs-byte hazard as `lookup_vendor`: keys come
                // from a JSON file that may be user-supplied via
                // NETSCLI_OUI_PATH, so a multi-byte key must not panic.
                if let Some(prefix) = oui_prefix(k) {
                    map.insert(prefix, s.to_string());
                }
            }
        }
    }
    Some(map)
}

#[cfg(test)]
mod tests {
    use super::{lookup_vendor, oui_prefix};

    #[test]
    fn normalizes_common_mac_separators() {
        for mac in ["AA:BB:CC:DD:EE:FF", "aa-bb-cc-dd-ee-ff", "aabbccddeeff"] {
            assert_eq!(oui_prefix(mac).as_deref(), Some("AABBCC"), "input: {mac}");
        }
    }

    #[test]
    fn multibyte_input_does_not_panic() {
        // Regression: `&key[..6]` panicked here because '€' is 3 bytes,
        // so byte index 6 fell inside it.
        assert_eq!(oui_prefix("aabbc€"), None);
        assert_eq!(lookup_vendor("aabbc€"), None);
        for mac in ["€€€€€€", "日本語テスト", "aa:bb:c€"] {
            assert!(lookup_vendor(mac).is_none(), "input: {mac}");
        }
    }

    #[test]
    fn rejects_short_and_non_hex_input() {
        assert_eq!(oui_prefix("aabb"), None);
        assert_eq!(oui_prefix(""), None);
        assert_eq!(oui_prefix("zzzzzz"), None);
        assert_eq!(oui_prefix("not-a-mac-at-all"), None);
    }
}
