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
    let key = mac.to_ascii_uppercase().replace([':', '-'], "");
    let prefix = if key.len() >= 6 {
        &key[..6]
    } else {
        return None;
    };
    map.get(prefix).cloned()
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

    // Dev-build fallback: when running `cargo run` from the workspace root
    // without `data/` alongside the binary, resolve relative to the crate.
    #[cfg(debug_assertions)]
    {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        candidates.push(PathBuf::from(manifest_dir).join("../../data/oui.min.json.gz"));
        candidates.push(PathBuf::from(manifest_dir).join("../../data/oui.json"));
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
                let cleaned = k.replace([':', '-'], "");
                if cleaned.len() >= 6 {
                    map.insert(cleaned[..6].to_ascii_uppercase(), s.to_string());
                }
            }
        }
    }
    Some(map)
}
