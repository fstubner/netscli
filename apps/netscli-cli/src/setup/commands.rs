use anyhow::{anyhow, Result};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const INSTALL_CMD_TIMEOUT: Duration = Duration::from_secs(30 * 60); // 30 minutes

/// A dependency-install step the setup wizard can offer.
///
/// `runnable` matters: [`run_command_line`] spawns argv directly with no
/// shell, so a "command" containing shell operators or prose cannot be
/// executed. Previously every platform's string was passed to the
/// spawner regardless, which meant `--execute` was broken on two of
/// three platforms:
///
/// - Linux: `sudo apt-get update && sudo apt-get install …` became
///   `sudo ["apt-get", "update", "&&", "apt-get", …]`, so `&&` was
///   handed to apt-get as a literal package name and it errored.
/// - Windows: `Install Wireshark (includes npcap) …` is prose; the
///   spawner tried to exec a program called `Install` and failed.
///
/// Only macOS's `brew install …` was ever valid argv. Rather than
/// introduce a shell (which would make an injection surface out of a
/// string we build ourselves), non-argv guidance is now marked
/// advisory-only and printed instead of run.
#[derive(Debug, Clone)]
pub(super) struct InstallCommand {
    /// The command line, or the human-readable instruction.
    pub(super) display: String,
    /// Whether `display` is a real argv that can be spawned.
    pub(super) runnable: bool,
}

impl InstallCommand {
    fn runnable(display: &str) -> Self {
        Self {
            display: display.to_string(),
            runnable: true,
        }
    }

    fn advisory(display: &str) -> Self {
        Self {
            display: display.to_string(),
            runnable: false,
        }
    }
}

pub(super) fn recommend_commands() -> Vec<InstallCommand> {
    if cfg!(target_os = "macos") {
        vec![InstallCommand::runnable("brew install libpcap tcpdump")]
    } else if cfg!(target_os = "linux") {
        // Two separate argv invocations rather than one `&&` string, so
        // both can actually be spawned.
        vec![
            InstallCommand::runnable("sudo apt-get update"),
            InstallCommand::runnable("sudo apt-get install -y libpcap-dev tcpdump"),
        ]
    } else if cfg!(target_os = "windows") {
        vec![InstallCommand::advisory(
            "Install Wireshark (includes Npcap), or run: choco install wireshark",
        )]
    } else {
        vec![InstallCommand::advisory(
            "Install libpcap/tcpdump using your platform's package manager",
        )]
    }
}

/// Spawn a command line as argv. Returns `Ok(None)` when there is
/// nothing to run.
pub(super) async fn run_command_line(cmdline: &str) -> Result<Option<std::process::ExitStatus>> {
    let mut parts =
        shell_words::split(cmdline).map_err(|e| anyhow!("Failed to parse command: {}", e))?;
    if parts.is_empty() {
        return Ok(None);
    }

    let program = parts.remove(0);
    run_command_with_timeout(&program, &parts, INSTALL_CMD_TIMEOUT)
        .await
        .map(Some)
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

#[cfg(test)]
mod tests {
    use super::{recommend_commands, run_command_line};

    #[test]
    fn every_runnable_command_is_valid_argv() {
        // The bug this pins: a "command" containing shell operators
        // parses into argv where the operator becomes a literal
        // argument, and the install silently fails.
        for cmd in recommend_commands() {
            if !cmd.runnable {
                continue;
            }
            let parts = shell_words::split(&cmd.display)
                .unwrap_or_else(|e| panic!("unparseable command {:?}: {e}", cmd.display));
            assert!(!parts.is_empty(), "empty command: {:?}", cmd.display);
            for shell_token in ["&&", "||", "|", ";", ">", "<"] {
                assert!(
                    !parts.iter().any(|p| p == shell_token),
                    "runnable command {:?} contains shell operator {shell_token:?}; \
                     run_command_line spawns argv directly and cannot honour it",
                    cmd.display
                );
            }
        }
    }

    #[test]
    fn recommendations_are_never_empty() {
        assert!(!recommend_commands().is_empty());
    }

    #[tokio::test]
    async fn empty_command_line_runs_nothing() {
        assert!(run_command_line("   ").await.unwrap().is_none());
    }
}
