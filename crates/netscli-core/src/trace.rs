use serde::Serialize;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::watch;

use crate::error::{Error, Result};

/// Process creation flag that stops a console program opening a window.
///
/// The installed desktop app is a GUI-subsystem process with no console, so a
/// console tool it starts gets a new one. With Windows Terminal as the default
/// terminal that is a visible window titled with the tool's path, open for as
/// long as the trace runs. The CLI and TUI start the tool from a console of
/// their own. Same flag, and same reason, as `arp/platform/command.rs`.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct TraceResult {
    pub host: String,
    pub tool: String,
    pub exit_code: Option<i32>,
    pub lines: Vec<String>,
}

pub async fn trace_route(
    host: &str,
    max_hops: u32,
    resolve: bool,
    progress: Option<watch::Sender<String>>,
) -> Result<TraceResult> {
    ensure_not_an_option(host)?;
    let max_hops = max_hops.clamp(1, 255);

    #[cfg(windows)]
    {
        let args = build_tracert_args(host, max_hops, resolve);
        // Absolute System32 path rather than a bare name -- see
        // `common::system_tools`. The Unix branch below keeps its bare names
        // deliberately: its traceroute -> tracepath fallback works by
        // spawning each and checking for a not-found error, which needs the
        // PATH lookup that an absolute path would bypass, and Unix `exec`
        // does not search the executable's own directory anyway.
        let tracert = crate::common::system_tool("tracert");
        let tracert = tracert.to_string_lossy().into_owned();
        run_command_streaming(&tracert, &args, host, progress).await
    }

    #[cfg(not(windows))]
    {
        let mut last_err: Option<Error> = None;
        let mut progress = progress;
        for (tool, args) in [
            ("traceroute", build_traceroute_args(host, max_hops, resolve)),
            ("tracepath", build_tracepath_args(host, max_hops, resolve)),
        ] {
            match run_command_streaming(tool, &args, host, progress.clone()).await {
                Ok(res) => return Ok(res),
                Err(e) => {
                    if is_not_found(&e) {
                        last_err = Some(e);
                        progress = None;
                        continue;
                    }
                    return Err(e);
                }
            }
        }

        Err(last_err.unwrap_or_else(|| Error::unsupported("trace tool unavailable")))
    }
}

/// Refuse a target that the trace tool would read as one of its own options.
///
/// The target is handed to `tracert`, `traceroute` or `tracepath` as a plain
/// argument, so `-d` or `--help` is a flag and not a host, and so is `/d` for
/// Windows' `tracert`, which takes `/` options as well as `-` ones
/// (`tracert /d /h 1 127.0.0.1` runs as `-d -h 1`). A host name or an address
/// never starts with either character, so refusing is exact. It is also the
/// only fix that works everywhere, because Windows' `tracert` has no `--` to
/// end its options ("-- is not a valid command option").
///
/// The command line passes the target through as given, so
/// `netscli trace -- -d` reached the tool as a flag.
fn ensure_not_an_option(host: &str) -> Result<()> {
    let target = host.trim_start();
    if target.is_empty() {
        return Err(Error::invalid_input("trace target is empty"));
    }
    if target.starts_with(['-', '/']) {
        return Err(Error::invalid_input(format!(
            "trace target {host:?} looks like a command-line option, not a host"
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn build_tracert_args(host: &str, max_hops: u32, resolve: bool) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if !resolve {
        args.push("-d".to_string());
    }
    args.push("-h".to_string());
    args.push(max_hops.to_string());
    args.push(host.to_string());
    args
}

#[cfg(not(windows))]
fn build_traceroute_args(host: &str, max_hops: u32, resolve: bool) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if !resolve {
        args.push("-n".to_string());
    }
    args.push("-m".to_string());
    args.push(max_hops.to_string());
    args.push(host.to_string());
    args
}

#[cfg(not(windows))]
fn build_tracepath_args(host: &str, max_hops: u32, resolve: bool) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if !resolve {
        args.push("-n".to_string());
    }
    args.push("-m".to_string());
    args.push(max_hops.to_string());
    args.push(host.to_string());
    args
}

async fn run_command_streaming(
    tool: &str,
    args: &[String],
    host: &str,
    progress: Option<watch::Sender<String>>,
) -> Result<TraceResult> {
    let max_hops = args_max_hops(args).unwrap_or(0);
    let mut cmd = Command::new(tool);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| Error::Other(format!("failed to spawn {tool}: {e}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Error::Other("failed to capture stdout".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Error::Other("failed to capture stderr".to_string()))?;

    let mut out_lines: Vec<String> = Vec::new();
    // `split` rather than `lines`: `lines` fails on the first byte that is not
    // UTF-8, and that error ended the whole trace. See `decode_line`.
    let mut stdout_lines = BufReader::new(stdout).split(b'\n');
    let mut stderr_lines = BufReader::new(stderr).split(b'\n');
    let mut stdout_done = false;
    let mut stderr_done = false;
    let mut status: Option<std::process::ExitStatus> = None;

    while !(stdout_done && stderr_done && status.is_some()) {
        tokio::select! {
            line = stdout_lines.next_segment(), if !stdout_done => {
                match line.map_err(|e| Error::Other(format!("trace stdout read failed: {e}")))? {
                    Some(line) => {
                        let trimmed = decode_line(&line);
                        if let Some(tx) = progress.as_ref() {
                            if let Some(hop) = trimmed.split_whitespace().next().and_then(|t| t.parse::<u32>().ok()) {
                                let _ = tx.send(format!(
                                    "hop {hop}/{max_hops} - {rest}",
                                    rest = trimmed
                                ));
                            }
                        }
                        out_lines.push(trimmed);
                    }
                    None => stdout_done = true,
                }
            }
            line = stderr_lines.next_segment(), if !stderr_done => {
                match line.map_err(|e| Error::Other(format!("trace stderr read failed: {e}")))? {
                    Some(line) => {
                        let trimmed = decode_line(&line);
                        if !trimmed.is_empty() {
                            out_lines.push(trimmed);
                        }
                    }
                    None => stderr_done = true,
                }
            }
            s = child.wait(), if status.is_none() => {
                status = Some(s.map_err(|e| Error::Other(format!("trace process wait failed: {e}")))?);
            }
        }
    }

    Ok(TraceResult {
        host: host.to_string(),
        tool: tool.to_string(),
        exit_code: status.and_then(|s| s.code()),
        lines: out_lines,
    })
}

/// One line of the tool's output, with anything that is not UTF-8 replaced.
///
/// `tracert` translates its messages and writes them in the console's OEM code
/// page, so on a Windows set to a language with accented letters a timed-out
/// hop can print bytes that are not valid UTF-8 ("Zeitüberschreitung" is
/// `Zeit\x81berschreitung` in code page 850). Reading lines as strict UTF-8
/// turned the first of those into "trace stdout read failed" and discarded the
/// whole trace, including the hops already printed. The hop number and the
/// timings are plain ASCII, so a replacement character in the free text after
/// them costs nothing that matters. `ping -a` in `dns/reverse.rs` is decoded
/// the same way.
fn decode_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim_end().to_string()
}

fn args_max_hops(args: &[String]) -> Option<u32> {
    for i in 0..args.len().saturating_sub(1) {
        if (args[i] == "-h" || args[i] == "-m") && args[i + 1].parse::<u32>().is_ok() {
            return args[i + 1].parse::<u32>().ok();
        }
    }
    None
}

#[cfg(not(windows))]
fn is_not_found(err: &Error) -> bool {
    match err {
        Error::Other(message) => message.contains("os error 2") || message.contains("not found"),
        _ => false,
    }
}

#[cfg(test)]
mod tests;
