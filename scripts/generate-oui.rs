// Generate OUI vendor map from IEEE and Wireshark sources.
// Outputs: crates/netscli-core/data/oui.min.json.gz

use flate2::write::GzEncoder;
use flate2::Compression;
use reqwest::Client;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

const OUI_URLS: &[&str] = &[
    "https://standards-oui.ieee.org/oui/oui.csv",
    "https://standards-oui.ieee.org/oui36/oui36.csv",
    "https://standards-oui.ieee.org/oui28/mam.csv",
];

const WIRESHARK_MANUF_URL: &str = "https://www.wireshark.org/download/automated/data/manuf.gz";
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

fn canon_prefix(hex: &str) -> Option<String> {
    let cleaned: String = hex
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect::<String>()
        .to_uppercase();
    if cleaned.len() < 6 {
        return None;
    }
    let p = &cleaned[..6];
    Some(format!("{}:{}:{}", &p[0..2], &p[2..4], &p[4..6]))
}

async fn fetch_url(client: &Client, url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let response = client.get(url).send().await?;
    let text = response.text().await?;
    Ok(text)
}

async fn fetch_gz(client: &Client, url: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let response = client.get(url).send().await?;
    let bytes = response.bytes().await?;
    Ok(bytes.to_vec())
}

fn parse_oui_csv(csv: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut lines = csv.lines();

    // Skip header
    let header = lines.next().unwrap_or("");
    let cols: Vec<&str> = header
        .split(',')
        .map(|s| s.trim_matches('"').trim())
        .collect();

    let p_idx = cols
        .iter()
        .position(|c| c.to_lowercase().contains("assignment"));
    let o_idx = cols
        .iter()
        .position(|c| c.to_lowercase().contains("organization"));

    if p_idx.is_none() || o_idx.is_none() {
        return map;
    }

    let p_idx = p_idx.unwrap();
    let o_idx = o_idx.unwrap();

    for line in lines {
        if line.is_empty() {
            continue;
        }

        // Simple CSV parsing (handles quoted fields)
        let mut parts = Vec::new();
        let mut current = String::new();
        let mut in_quotes = false;

        for ch in line.chars() {
            match ch {
                '"' => in_quotes = !in_quotes,
                ',' if !in_quotes => {
                    parts.push(current.trim_matches('"').trim().to_string());
                    current.clear();
                }
                _ => current.push(ch),
            }
        }
        parts.push(current.trim_matches('"').trim().to_string());

        if parts.len() > p_idx.max(o_idx) {
            let pref = &parts[p_idx];
            let org = &parts[o_idx];
            if let Some(canon) = canon_prefix(pref) {
                map.entry(canon).or_insert_with(|| org.to_string());
            }
        }
    }

    map
}

fn parse_wireshark_manuf(
    data: &[u8],
) -> Result<HashMap<String, String>, Box<dyn std::error::Error>> {
    // Decompress gzip
    let mut decoder = flate2::read::GzDecoder::new(data);
    let mut text = String::new();
    std::io::Read::read_to_string(&mut decoder, &mut text)?;

    let mut map = HashMap::new();
    for line in text.lines() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let prefix_raw = parts[0];
        let vendor = parts[1..].join(" ");
        let hex: String = prefix_raw
            .split('/')
            .next()
            .unwrap_or(prefix_raw)
            .replace(':', "")
            .to_uppercase();

        if hex.len() >= 6 {
            let canon = format!("{}:{}:{}", &hex[0..2], &hex[2..4], &hex[4..6]);
            map.entry(canon).or_insert_with(|| vendor);
        }
    }

    Ok(map)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::builder().timeout(FETCH_TIMEOUT).build()?;
    println!("Fetching OUI data from IEEE...");
    let mut merged: HashMap<String, String> = HashMap::new();

    // Fetch IEEE CSV files
    for url in OUI_URLS {
        println!("Fetching {}...", url);
        let csv = fetch_url(&client, url).await?;
        let map = parse_oui_csv(&csv);
        println!("  Found {} entries", map.len());
        for (k, v) in map {
            merged.entry(k).or_insert(v);
        }
    }

    // Fetch Wireshark manuf
    println!("Fetching Wireshark manuf...");
    let gz_data = fetch_gz(&client, WIRESHARK_MANUF_URL).await?;
    let manuf_map = parse_wireshark_manuf(&gz_data)?;
    println!("  Found {} entries", manuf_map.len());
    for (k, v) in manuf_map {
        merged.entry(k).or_insert(v);
    }

    println!("\nTotal: {} unique prefixes", merged.len());

    // Convert to JSON
    let json_map: Map<String, Value> = merged
        .into_iter()
        .map(|(k, v)| (k, Value::String(v)))
        .collect();
    let json = serde_json::to_string(&json_map)?;

    // Write gzipped output. The canonical location is inside
    // netscli-core so the crate ships with a current dataset.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap_or(&manifest_dir);
    let out_path = repo_root
        .join("crates")
        .join("netscli-core")
        .join("data")
        .join("oui.min.json.gz");
    std::fs::create_dir_all(out_path.parent().unwrap_or(repo_root))?;
    let file = File::create(&out_path)?;
    let mut encoder = GzEncoder::new(file, Compression::default());
    encoder.write_all(json.as_bytes())?;
    encoder.finish()?;

    println!(
        "Wrote {} prefixes to {}",
        json_map.len(),
        out_path.display()
    );

    Ok(())
}
