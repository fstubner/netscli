use anyhow::{anyhow, Result};
use dirs::home_dir;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const SYSTEMD_USER_DIR: &str = ".config/systemd/user";

fn service_file_path() -> Result<PathBuf> {
    let home = home_dir().ok_or_else(|| anyhow!("Could not determine home directory"))?;
    Ok(home.join(SYSTEMD_USER_DIR).join("netscli-mcp.service"))
}

fn get_binary_path() -> Result<String> {
    // Prefer the path of the currently running binary: if the user ran
    // `netscli mcp-service --install`, that's exactly the binary they want
    // systemd to launch. Falls back to `which` in PATH, then a generic path.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(s) = exe.to_str() {
            return Ok(s.to_string());
        }
    }

    let output = Command::new("which").arg("netscli").output()?;
    if output.status.success() {
        let path = String::from_utf8(output.stdout)?.trim().to_string();
        if !path.is_empty() {
            return Ok(path);
        }
    }

    Ok("/usr/local/bin/netscli".to_string())
}

/// Generate the systemd unit file content for a given binary path.
///
/// Extracted as a pure function so the exact format (quoting, env vars,
/// install target) can be covered by unit tests without needing a live
/// systemd instance.
pub(crate) fn render_service_unit(binary_path: &str) -> String {
    // Quote the binary path so spaces in the install location don't break
    // systemd's shell-like argument splitting. Set `RUST_LOG=info` so the
    // new tracing output lands in the journal at a useful level by default.
    format!(
        r#"[Unit]
Description=NetsCLI MCP Server
After=network.target

[Service]
Type=simple
ExecStart="{binary_path}" serve
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=RUST_LOG=info

[Install]
WantedBy=default.target
"#
    )
}

pub fn install_service() -> Result<()> {
    let service_path = service_file_path()?;
    let binary_path = get_binary_path()?;

    // Ensure directory exists
    if let Some(parent) = service_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let service_content = render_service_unit(&binary_path);

    fs::write(&service_path, service_content)?;
    println!("✅ Service file created at: {}", service_path.display());
    println!("\n📋 Next steps:");
    println!("  1. Reload systemd: systemctl --user daemon-reload");
    println!("  2. Enable service: systemctl --user enable netscli-mcp.service");
    println!("  3. Start service: systemctl --user start netscli-mcp.service");
    println!("  4. Check status: systemctl --user status netscli-mcp.service");

    Ok(())
}

pub fn uninstall_service() -> Result<()> {
    let service_path = service_file_path()?;

    if service_path.exists() {
        // Stop and disable first
        let _ = Command::new("systemctl")
            .args(["--user", "stop", "netscli-mcp.service"])
            .output();
        let _ = Command::new("systemctl")
            .args(["--user", "disable", "netscli-mcp.service"])
            .output();

        fs::remove_file(&service_path)?;
        println!("✅ Service file removed: {}", service_path.display());
    } else {
        println!("ℹ️  Service file not found: {}", service_path.display());
    }

    Ok(())
}

pub fn show_status() -> Result<()> {
    let service_path = service_file_path()?;

    println!("Service file: {}", service_path.display());
    if service_path.exists() {
        println!("Status: ✅ Installed");

        // Try to get systemd status
        let output = Command::new("systemctl")
            .args(["--user", "status", "netscli-mcp.service", "--no-pager"])
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                println!("\nSystemd status:");
                println!("{}", String::from_utf8_lossy(&out.stdout));
            } else {
                println!("\n⚠️  Service may not be enabled/started yet.");
                println!("   Run: systemctl --user enable netscli-mcp.service");
                println!("   Run: systemctl --user start netscli-mcp.service");
            }
        }
    } else {
        println!("Status: ❌ Not installed");
        println!("\n💡 Run `netscli mcp-service --install` to create the service file.");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::render_service_unit;

    #[test]
    fn unit_file_contains_required_sections() {
        let unit = render_service_unit("/usr/local/bin/netscli");
        assert!(unit.contains("[Unit]"));
        assert!(unit.contains("[Service]"));
        assert!(unit.contains("[Install]"));
        assert!(unit.contains("WantedBy=default.target"));
    }

    #[test]
    fn unit_file_quotes_binary_path() {
        // Paths with spaces must round-trip through systemd's ExecStart
        // parser. The double-quoted form is the canonical way.
        let unit = render_service_unit("/home/a b/.cargo/bin/netscli");
        assert!(
            unit.contains(r#"ExecStart="/home/a b/.cargo/bin/netscli" serve"#),
            "expected quoted path with `serve` arg, got:\n{unit}"
        );
    }

    #[test]
    fn unit_file_sets_rust_log_env() {
        let unit = render_service_unit("/usr/local/bin/netscli");
        assert!(
            unit.contains("Environment=RUST_LOG=info"),
            "expected RUST_LOG=info so tracing output is visible in the journal"
        );
    }

    #[test]
    fn unit_file_restart_policy() {
        let unit = render_service_unit("/usr/local/bin/netscli");
        assert!(unit.contains("Restart=always"));
        assert!(unit.contains("RestartSec=5"));
    }

    #[test]
    fn unit_file_journal_logging() {
        let unit = render_service_unit("/usr/local/bin/netscli");
        assert!(unit.contains("StandardOutput=journal"));
        assert!(unit.contains("StandardError=journal"));
    }
}
