//! What is left of `netscli mcp-service`.
//!
//! It used to write a systemd user unit that ran `netscli serve`. That could
//! never work. `serve` speaks MCP over stdin and stdout and stops when stdin
//! closes, and systemd starts a service with stdin on /dev/null. So the
//! process exited at once, and `Restart=always` started it again every five
//! seconds for as long as the unit was enabled. An MCP client starts the
//! server itself, which is what the setup docs describe.
//!
//! So `--install` writes nothing and says why. `--uninstall` and `--status`
//! stay for the unit that earlier versions left behind. Every version wrote it
//! on every OS, so they look for it on every OS, including Windows and macOS,
//! where nothing could ever have read it.

use anyhow::{anyhow, bail, Result};
use dirs::home_dir;
use std::fs;
use std::path::{Path, PathBuf};

const UNIT_NAME: &str = "netscli-mcp.service";

fn service_file_path() -> Result<PathBuf> {
    let home = home_dir().ok_or_else(|| anyhow!("Could not determine home directory"))?;
    Ok(home
        .join(".config")
        .join("systemd")
        .join("user")
        .join(UNIT_NAME))
}

/// `--install` is kept so that a script or a habit gets an answer, not a
/// "no such flag". The answer is an error: nothing was installed.
pub fn install_service() -> Result<()> {
    bail!(
        "`netscli mcp-service --install` no longer installs anything.\n\
         \n\
         `netscli serve` speaks MCP over stdin and stdout, so the MCP client has to start it. \
         A systemd service starts it with no input, and it exits at once and restarts every 5 seconds.\n\
         \n\
         Add netscli to your MCP client's configuration instead. The setup guide is at \
         https://netscli.com/docs/mcp/\n\
         \n\
         To remove a unit that an earlier version installed, run `netscli mcp-service --uninstall`."
    )
}

/// Delete the unit file, and report whether there was one.
fn remove_unit_file(path: &Path) -> Result<bool> {
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(path)?;
    Ok(true)
}

pub fn uninstall_service() -> Result<()> {
    let service_path = service_file_path()?;

    // Stop and disable first, where systemd is. The file is removed on every
    // OS, because earlier versions wrote it on every OS.
    #[cfg(target_os = "linux")]
    {
        if service_path.exists() {
            for action in ["stop", "disable"] {
                let _ = std::process::Command::new("systemctl")
                    .args(["--user", action, UNIT_NAME])
                    .output();
            }
        }
    }

    if remove_unit_file(&service_path)? {
        println!("Removed {}", service_path.display());
    } else {
        println!("No unit file at {}", service_path.display());
    }
    Ok(())
}

pub fn show_status() -> Result<()> {
    let service_path = service_file_path()?;

    println!("Unit file: {}", service_path.display());
    if service_path.exists() {
        println!(
            "Present. An earlier version of netscli installed it. It cannot run a useful server. \
             Remove it with `netscli mcp-service --uninstall`."
        );
    } else {
        println!("Not present. There is nothing to remove.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_installs_nothing_and_says_where_to_go_instead() {
        let err = install_service().expect_err("--install must not succeed");
        let message = err.to_string();
        assert!(message.contains("no longer installs anything"), "{message}");
        assert!(
            message.contains("https://netscli.com/docs/mcp/"),
            "{message}"
        );
        assert!(message.contains("--uninstall"), "{message}");
    }

    #[test]
    fn a_leftover_unit_file_is_removed_and_a_second_run_finds_none() {
        let dir = std::env::temp_dir().join(format!("netscli-unit-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let unit = dir.join(UNIT_NAME);
        fs::write(&unit, "[Service]\nExecStart=netscli serve\n").unwrap();

        assert!(remove_unit_file(&unit).unwrap());
        assert!(!unit.exists());
        assert!(!remove_unit_file(&unit).unwrap());

        fs::remove_dir_all(&dir).unwrap();
    }
}
