//! Locating the `netscli` CLI, for the MCP section of Settings.
//!
//! WHY THIS EXISTS AT ALL. The desktop app does not ship the CLI and does not
//! depend on it: this crate links `netscli-core` directly, there is no
//! `externalBin` in tauri.conf.json, and nothing here spawns a `netscli`
//! process. So someone who installed only the desktop app -- `winget install
//! netscli-gui`, the MSI, the DMG, the .deb, the AppImage -- has no `netscli`
//! executable anywhere on the machine.
//!
//! That matters because the MCP server IS the CLI. An MCP client starts the
//! server itself by running `netscli serve` and talking JSON-RPC over the
//! pipe, so the config block a client needs is a path to that binary. Without
//! one there is nothing to configure, and the honest thing for the panel to
//! say is "install the CLI first" rather than to print a config naming a file
//! that does not exist.
//!
//! WHY `--version` IS RUN. Finding a file called `netscli` is not the same as
//! finding this program. A config block is pasted into another application and
//! fails there, silently, hours later -- the cost of being wrong is paid far
//! from here, so the check is worth one process spawn. The binary is only
//! accepted if it answers `--version` and names itself.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// The filename to look for. Windows only ever ships the `.exe`; PATHEXT
/// resolution is deliberately not reimplemented here.
const BIN_NAME: &str = if cfg!(windows) {
    "netscli.exe"
} else {
    "netscli"
};

/// A found binary gets this long to answer `--version`.
///
/// Bounded because this runs while the Settings dialog is opening and the
/// candidate is an arbitrary executable that happens to carry the right name.
/// A hung probe would freeze the panel with no way out.
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliDetection {
    /// Absolute path to a verified `netscli`, or `None` when the CLI is not
    /// installed. The frontend switches the whole section on this.
    path: Option<String>,
    /// What the binary reported, e.g. `0.3.1`. Shown so a stale CLI beside a
    /// newer desktop app is visible rather than merely present.
    version: Option<String>,
    /// Which platform's install route the panel should offer when `path` is
    /// empty. Decided here because this crate already knows at compile time,
    /// and the alternative in the webview is sniffing a user-agent string.
    /// The wording that goes with it stays in the frontend with the rest of
    /// the UI copy.
    os: &'static str,
}

/// `windows` | `macos` | `linux`, matching the site's platform keys so the two
/// sets of install instructions can be compared against each other.
const fn current_os() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Where a `netscli` might live, in the order worth trying.
///
/// PATH comes first because it is the one the user's own shell would pick,
/// and because an MCP client that DOES inherit PATH will resolve the same
/// file. The explicit directories after it are the install routes the site
/// documents, and they exist because GUI-launched clients frequently do not
/// inherit a login shell's PATH -- the reason the config block wants an
/// absolute path in the first place.
fn candidate_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Some(path) = std::env::var_os("PATH") {
        out.extend(std::env::split_paths(&path).map(|dir| dir.join(BIN_NAME)));
    }

    if let Some(home) = dirs::home_dir() {
        // `cargo install netscli`, on every platform.
        out.push(home.join(".cargo").join("bin").join(BIN_NAME));

        #[cfg(windows)]
        out.push(home.join("scoop").join("shims").join(BIN_NAME));

        #[cfg(not(windows))]
        out.push(home.join(".local").join("bin").join(BIN_NAME));
    }

    #[cfg(windows)]
    if let Some(local) = dirs::data_local_dir() {
        // Where winget puts its shims.
        out.push(
            local
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join(BIN_NAME),
        );
    }

    #[cfg(not(windows))]
    {
        out.push(PathBuf::from("/usr/local/bin").join(BIN_NAME));
        // Homebrew on Apple silicon. Intel's /usr/local/bin is already above.
        out.push(PathBuf::from("/opt/homebrew/bin").join(BIN_NAME));
    }

    out
}

/// Run `--version` and return the version if the binary identifies itself as
/// netscli. `None` for anything else, including a timeout or a non-zero exit.
async fn probe_version(path: &Path) -> Option<String> {
    let output = timeout(PROBE_TIMEOUT, Command::new(path).arg("--version").output())
        .await
        .ok()?
        .ok()?;

    if !output.status.success() {
        return None;
    }

    // clap prints `<name> <version>`. Both halves are checked: the name is
    // what rules out an unrelated program that happens to be called netscli,
    // which is the case this probe exists for.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut parts = stdout.split_whitespace();
    let name = parts.next()?;
    if name != "netscli" {
        return None;
    }
    parts.next().map(str::to_string)
}

/// Find an installed `netscli`, or report that there is none.
///
/// Returns `Ok` with empty fields rather than an error when nothing is found:
/// "the CLI is not installed" is a normal state for a desktop-only install and
/// the panel renders install guidance for it. An `Err` here would put that
/// ordinary case down the failure path.
#[tauri::command]
pub(crate) async fn detect_netscli_cli() -> Result<CliDetection, String> {
    for candidate in candidate_paths() {
        if !candidate.is_file() {
            continue;
        }
        if let Some(version) = probe_version(&candidate).await {
            return Ok(CliDetection {
                path: Some(candidate.to_string_lossy().into_owned()),
                version: Some(version),
                os: current_os(),
            });
        }
    }

    Ok(CliDetection {
        path: None,
        version: None,
        os: current_os(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_are_named_for_the_platform() {
        let expected = if cfg!(windows) {
            "netscli.exe"
        } else {
            "netscli"
        };
        let candidates = candidate_paths();
        assert!(!candidates.is_empty());
        assert!(candidates
            .iter()
            .all(|p| p.file_name().and_then(|n| n.to_str()) == Some(expected)));
    }

    #[tokio::test]
    async fn a_binary_that_is_not_netscli_is_rejected() {
        // Every platform has *some* executable that answers a flag and is not
        // netscli. This asserts the name check does the work, not merely that
        // the process ran.
        let other = if cfg!(windows) {
            PathBuf::from("cmd.exe")
        } else {
            PathBuf::from("/bin/echo")
        };
        if other.is_file() || cfg!(windows) {
            assert_eq!(probe_version(&other).await, None);
        }
    }
}
