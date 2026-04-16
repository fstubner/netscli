use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use dialoguer::{theme::ColorfulTheme, Confirm};
use dirs::home_dir;
#[cfg(feature = "pcap")]
use netscli_core::PcapEngine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

#[cfg(feature = "pcap")]
const WHICH_TIMEOUT: Duration = Duration::from_secs(5);
const INSTALL_CMD_TIMEOUT: Duration = Duration::from_secs(30 * 60); // 30 minutes

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

fn load_state() -> Option<SetupState> {
    let path = config_path().ok()?;
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_state(state: &SetupState) -> Result<()> {
    let path = ensure_config_dir()?;
    let data = serde_json::to_string_pretty(state)?;
    fs::write(path, data)?;
    Ok(())
}

async fn run_command_with_timeout(
    program: &str,
    args: &[String],
    timeout_dur: Duration,
) -> Result<std::process::ExitStatus> {
    let mut child = Command::new(program).args(args).spawn()?;
    match timeout(timeout_dur, child.wait()).await {
        Ok(res) => Ok(res?),
        Err(_) => {
            // Best-effort: try to terminate the child to avoid leaving it running.
            let _ = child.kill().await;
            Err(anyhow!(
                "command timed out after {}s: {} {}",
                timeout_dur.as_secs(),
                program,
                args.join(" ")
            ))
        }
    }
}

#[cfg(feature = "pcap")]
async fn has_command(cmd: &str) -> bool {
    let program = if cfg!(windows) { "where" } else { "which" };
    let mut child = match Command::new(program)
        .arg(cmd)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    match timeout(WHICH_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => status.success(),
        _ => {
            let _ = child.kill().await;
            false
        }
    }
}

#[cfg(feature = "pcap")]
async fn check_pcap() -> DependencyStatus {
    let result = tokio::task::spawn_blocking(PcapEngine::check_support).await;
    match result {
        Ok(Ok(devs)) => DependencyStatus {
            name: "libpcap".to_string(),
            installed: true,
            details: Some(format!("interfaces: {}", devs.join(", "))),
        },
        Ok(Err(e)) => DependencyStatus {
            name: "libpcap".to_string(),
            installed: false,
            details: Some(e.to_string()),
        },
        Err(e) => DependencyStatus {
            name: "libpcap".to_string(),
            installed: false,
            details: Some(e.to_string()),
        },
    }
}

#[cfg(not(feature = "pcap"))]
async fn check_pcap() -> DependencyStatus {
    DependencyStatus {
        name: "libpcap".to_string(),
        installed: true,
        details: Some(
            "pcap support disabled at compile time (build with --features pcap to enable)"
                .to_string(),
        ),
    }
}

async fn collect_status() -> Vec<DependencyStatus> {
    let mut deps = Vec::new();
    deps.push(check_pcap().await);
    #[cfg(feature = "pcap")]
    {
        let tcpdump = has_command("tcpdump").await;
        deps.push(DependencyStatus {
            name: "tcpdump".to_string(),
            installed: tcpdump,
            details: None,
        });
    }

    deps
}

fn recommend_commands() -> Vec<String> {
    if cfg!(target_os = "macos") {
        vec!["brew install libpcap tcpdump".to_string()]
    } else if cfg!(target_os = "linux") {
        vec!["sudo apt-get update && sudo apt-get install -y libpcap-dev tcpdump".to_string()]
    } else if cfg!(target_os = "windows") {
        vec!["Install Wireshark (includes npcap) or `choco install wireshark`".to_string()]
    } else {
        vec!["Install libpcap/tcpdump using your package manager".to_string()]
    }
}

pub async fn run_setup(execute: bool, print_only: bool) -> Result<()> {
    let theme = ColorfulTheme::default();

    println!("\n🚀 Welcome to NetsCLI Setup Wizard\n");

    let deps = collect_status().await;
    let mut state = SetupState {
        last_checked: Some(Utc::now()),
        deps: deps.clone(),
    };

    // Show current status
    println!("📋 Checking dependencies...\n");
    for d in &deps {
        let status = if d.installed { "✓" } else { "✗" };
        let icon = if d.installed { "✅" } else { "❌" };
        println!("  {} {} {}", icon, status, d.name);
        if let Some(info) = &d.details {
            println!("      {}", info);
        }
    }

    let missing: Vec<_> = deps.iter().filter(|d| !d.installed).collect();
    if missing.is_empty() {
        println!("\n✨ All optional dependencies are installed!\n");
        save_state(&state)?;
        return Ok(());
    }

    // Interactive mode (default)
    if !print_only && !execute {
        println!("\n📦 Missing dependencies detected. Let's set them up:\n");

        let commands = recommend_commands();
        let mut to_install = Vec::new();

        for (idx, dep) in missing.iter().enumerate() {
            let install_cmd = commands.get(idx).or_else(|| commands.first());
            let Some(install_cmd) = install_cmd else {
                println!("  ⚠️  No install command available for {}", dep.name);
                continue;
            };

            let should_install = Confirm::with_theme(&theme)
                .with_prompt(format!("Install {}?", dep.name))
                .default(true)
                .interact()?;

            if should_install {
                to_install.push((dep.name.clone(), install_cmd.clone()));
            }
        }

        if to_install.is_empty() {
            println!("\n⏭️  Skipping installation. You can run `netscli setup --execute` later.\n");
            save_state(&state)?;
            return Ok(());
        }

        println!("\n🔧 Installing dependencies...\n");
        for (name, cmdline) in &to_install {
            println!("Installing {}...", name);
            let mut parts = shell_words::split(cmdline)
                .map_err(|e| anyhow!("Failed to parse command: {}", e))?;
            if parts.is_empty() {
                println!("  ⚠️  Nothing to run.");
                continue;
            }

            let program = parts.remove(0);
            let status = run_command_with_timeout(&program, &parts, INSTALL_CMD_TIMEOUT).await?;

            if status.success() {
                println!("  ✅ {} installed successfully", name);
            } else {
                println!("  ❌ {} installation failed (exit code: {})", name, status);
            }
        }

        // Re-check after install
        let refreshed = collect_status().await;
        state.deps = refreshed.clone();
        save_state(&state)?;

        println!("\n📊 Final status:\n");
        for d in &refreshed {
            let icon = if d.installed { "✅" } else { "❌" };
            println!("  {} {}", icon, d.name);
        }
        println!();

        return Ok(());
    }

    // Print-only mode
    if print_only {
        let commands = recommend_commands();
        println!("\n📋 Recommended install commands:\n");
        for cmd in &commands {
            println!("  {}", cmd);
        }
        println!("\n💡 Copy and paste these commands to install dependencies.\n");
        save_state(&state)?;
        return Ok(());
    }

    // Execute mode (non-interactive)
    if execute {
        let commands = recommend_commands();
        println!("\n🔧 Installing dependencies (non-interactive mode)...\n");

        if let Some(cmdline) = commands.first() {
            println!("Running: {}\n", cmdline);
            let mut parts = shell_words::split(cmdline)
                .map_err(|e| anyhow!("Failed to parse command: {}", e))?;
            if parts.is_empty() {
                println!("Nothing to run.");
            } else {
                let program = parts.remove(0);
                let status =
                    run_command_with_timeout(&program, &parts, INSTALL_CMD_TIMEOUT).await?;
                if status.success() {
                    println!("✅ Install command succeeded.");
                } else {
                    println!("❌ Install command exited with status {}", status);
                }
            }
        }

        let refreshed = collect_status().await;
        state.deps = refreshed.clone();
        save_state(&state)?;

        println!("\n📊 Post-install status:\n");
        for d in &refreshed {
            let icon = if d.installed { "✅" } else { "❌" };
            println!("  {} {}", icon, d.name);
        }
        println!();
    }

    Ok(())
}

pub async fn print_status(json: bool, yaml: bool) -> Result<()> {
    // Validate flag combinations BEFORE doing any work (including writing
    // state to disk) so `--json --yaml` is a clean rejection instead of a
    // half-completed mutation.
    if json && yaml {
        return Err(anyhow!("Use only one of --json or --yaml"));
    }

    let deps = collect_status().await;
    let mut state = load_state().unwrap_or_default();
    state.last_checked = Some(Utc::now());
    state.deps = deps.clone();
    save_state(&state)?;

    if yaml {
        println!("{}", serde_yaml_ng::to_string(&state)?);
    } else if json {
        println!("{}", serde_json::to_string_pretty(&state)?);
    } else {
        println!("NetsCLI diagnostics:");
        for d in deps {
            let status = if d.installed { "✓" } else { "✗" };
            println!("  {} {}", status, d.name);
            if let Some(info) = d.details {
                println!("      {}", info);
            }
        }
    }
    Ok(())
}
