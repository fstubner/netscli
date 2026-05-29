use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use dirs::home_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct SetupState {
    pub last_checked: Option<DateTime<Utc>>,
    pub deps: Vec<DependencyStatus>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DependencyStatus {
    pub name: String,
    pub installed: bool,
    pub details: Option<String>,
}

pub fn config_exists() -> bool {
    config_path().map(|p| p.exists()).unwrap_or(false)
}

/// Resolve the config path, returning an error when we can't determine a
/// home directory (container/CI with no `HOME` set). The previous
/// behavior silently wrote to the current working directory, which led
/// to stray `.netscli/` folders showing up in whatever repo the user
/// happened to be in.
fn config_path() -> Result<PathBuf> {
    let home = home_dir()
        .ok_or_else(|| anyhow!("could not determine home directory (set HOME or USERPROFILE)"))?;
    Ok(home.join(".netscli").join("config.json"))
}

fn ensure_config_dir() -> Result<PathBuf> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(path)
}

pub(super) fn load_state() -> Option<SetupState> {
    let path = config_path().ok()?;
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

pub(super) fn save_state(state: &SetupState) -> Result<()> {
    let path = ensure_config_dir()?;
    let data = serde_json::to_string_pretty(state)?;
    fs::write(path, data)?;
    Ok(())
}
