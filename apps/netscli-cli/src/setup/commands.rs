use anyhow::{anyhow, Result};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const INSTALL_CMD_TIMEOUT: Duration = Duration::from_secs(30 * 60); // 30 minutes

pub(super) fn recommend_commands() -> Vec<String> {
    if cfg!(target_os = "macos") {
        vec!["brew install libpcap tcpdump".to_string()]
    } else if cfg!(target_os = "linux") {
        vec!["sudo apt-get update && sudo apt-get install -y libpcap-dev tcpdump".to_string()]
    } else if cfg!(target_os = "windows") {
        vec!["choco install -y wireshark".to_string()]
    } else {
        vec!["Install libpcap/tcpdump using your package manager".to_string()]
    }
}

pub(super) async fn run_command_line(cmdline: &str) -> Result<Option<std::process::ExitStatus>> {
    let cmdline = cmdline.trim();
    if cmdline.is_empty() {
        return Ok(None);
    }

    if cfg!(windows) {
        if cmdline.contains("&&") || cmdline.contains('|') {
            return run_command_with_timeout("cmd", &["/c".to_string(), cmdline.to_string()], INSTALL_CMD_TIMEOUT).await.map(Some);
        }
        let parts = shell_words::split(cmdline).map_err(|e| anyhow!("Failed to parse command: {}", e))?;
        if parts.is_empty() {
            return Ok(None);
        }
        let mut parts = parts;
        let program = parts.remove(0);
        run_command_with_timeout(&program, &parts, INSTALL_CMD_TIMEOUT).await.map(Some)
    } else {
        // On Unix, use sh -c to reliably execute chained commands, pipes, and environment variables
        run_command_with_timeout("sh", &["-c".to_string(), cmdline.to_string()], INSTALL_CMD_TIMEOUT).await.map(Some)
    }
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
