use anyhow::Result;
use dirs::home_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::IpAddr;
use std::path::PathBuf;

pub const DEFAULT_MAX_CONCURRENT_PROBES: usize = netscli_core::DEFAULT_CONCURRENCY;
pub const MAX_CONCURRENT_PROBE_OPTIONS: [usize; 6] = [32, 64, 128, 256, 512, 1024];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum StatsUnit {
    Kbps,
    #[default]
    Mbps,
    Gbps,
}

impl StatsUnit {
    pub fn suffix(self) -> &'static str {
        match self {
            Self::Kbps => "Kbps",
            Self::Mbps => "Mbps",
            Self::Gbps => "Gbps",
        }
    }

    pub fn scale_from_mbps(self, mbps: f64) -> f64 {
        match self {
            Self::Kbps => mbps * 1000.0,
            Self::Mbps => mbps,
            Self::Gbps => mbps / 1000.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TuiSettings {
    #[serde(default)]
    pub stats_unit: StatsUnit,
    #[serde(default = "default_max_concurrent_probes")]
    pub max_concurrent_probes: usize,
    pub stats_interface: Option<String>,
    pub display_interface: Option<String>,
    pub display_ip: Option<String>,
}

pub fn clamp_max_concurrent_probes(value: usize) -> usize {
    value.clamp(1, 1024)
}

fn normalize_settings(mut settings: TuiSettings) -> TuiSettings {
    settings.max_concurrent_probes = clamp_max_concurrent_probes(settings.max_concurrent_probes);
    settings
}

fn default_max_concurrent_probes() -> usize {
    DEFAULT_MAX_CONCURRENT_PROBES
}

impl Default for TuiSettings {
    fn default() -> Self {
        Self {
            stats_unit: StatsUnit::default(),
            max_concurrent_probes: DEFAULT_MAX_CONCURRENT_PROBES,
            stats_interface: None,
            display_interface: None,
            display_ip: None,
        }
    }
}

fn settings_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".netscli").join("tui-settings.json"))
}

/// Load persisted settings. Returns defaults if the file is absent OR if
/// parsing fails — but in the latter case we emit a warning so the user
/// can see their hand-edited file is invalid instead of silently losing
/// their customizations.
pub fn load_settings() -> TuiSettings {
    let Some(path) = settings_path() else {
        return TuiSettings::default();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return TuiSettings::default();
    };
    match serde_json::from_str::<TuiSettings>(&data) {
        Ok(s) => normalize_settings(s),
        Err(e) => {
            eprintln!(
                "netscli: warning: could not parse {} ({e}); using defaults. \
                 Fix the file or delete it to stop seeing this message.",
                path.display()
            );
            TuiSettings::default()
        }
    }
}

/// Persist settings atomically: write to a `.tmp` sibling then rename.
/// A crash mid-write no longer leaves a truncated/corrupt JSON file.
pub fn save_settings(settings: &TuiSettings) -> Result<()> {
    use anyhow::Context;

    let path = settings_path().context("could not determine settings path (no HOME)")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_string_pretty(settings)?;

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).with_context(|| format!("writing {}", tmp.display()))?;
    // `fs::rename` is atomic on POSIX; on Windows it replaces the existing
    // file when the target is on the same volume (which .netscli/ always is).
    fs::rename(&tmp, &path)
        .with_context(|| format!("renaming {} to {}", tmp.display(), path.display()))?;
    Ok(())
}

pub fn resolve_context_address(settings: &TuiSettings) -> Option<String> {
    if let Some(ip) = settings.display_ip.as_deref() {
        if ip.trim().is_empty() {
            return None;
        }
        if let Ok(parsed) = ip.trim().parse::<IpAddr>() {
            return Some(parsed.to_string());
        }
        return None;
    }

    let iface = settings
        .display_interface
        .as_deref()
        .or(settings.stats_interface.as_deref());
    if let Some(iface) = iface {
        for info in netscli_core::NetworkManager::get_interfaces() {
            if info.name == iface {
                for net in info.ips {
                    if let IpAddr::V4(v4) = net.addr() {
                        return Some(v4.to_string());
                    }
                }
            }
        }
    }

    netscli_core::detect_default_ipv4_addr().map(|ip| ip.to_string())
}
