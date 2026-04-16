use anyhow::{Context, Result};
use serde::Serialize;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::watch;

#[cfg(not(windows))]
use std::io::ErrorKind;

#[derive(Debug, Clone, Serialize)]
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
    let max_hops = max_hops.clamp(1, 255);

    #[cfg(windows)]
    {
        let args = build_tracert_args(host, max_hops, resolve);
        return run_command_streaming("tracert", &args, host, progress).await;
    }

    #[cfg(not(windows))]
    {
        let mut last_err: Option<anyhow::Error> = None;
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

        Err(last_err.unwrap_or_else(|| anyhow::anyhow!("trace tool unavailable")))
    }
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

    let mut child = cmd
        .spawn()
        .with_context(|| format!("failed to spawn {tool}"))?;
    let stdout = child.stdout.take().context("failed to capture stdout")?;
    let stderr = child.stderr.take().context("failed to capture stderr")?;

    let mut out_lines: Vec<String> = Vec::new();
    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();
    let mut stdout_done = false;
    let mut stderr_done = false;
    let mut status: Option<std::process::ExitStatus> = None;

    while !(stdout_done && stderr_done && status.is_some()) {
        tokio::select! {
            line = stdout_lines.next_line(), if !stdout_done => {
                match line? {
                    Some(line) => {
                        let trimmed = line.trim_end().to_string();
                        if let Some(tx) = progress.as_ref() {
                            if let Some(hop) = trimmed.split_whitespace().next().and_then(|t| t.parse::<u32>().ok()) {
                                let _ = tx.send(format!(
                                    "hop {hop}/{max_hops} \u{2022} {rest}",
                                    rest = trimmed
                                ));
                            }
                        }
                        out_lines.push(trimmed);
                    }
                    None => stdout_done = true,
                }
            }
            line = stderr_lines.next_line(), if !stderr_done => {
                match line? {
                    Some(line) => {
                        let trimmed = line.trim_end().to_string();
                        if !trimmed.is_empty() {
                            out_lines.push(trimmed);
                        }
                    }
                    None => stderr_done = true,
                }
            }
            s = child.wait(), if status.is_none() => {
                status = Some(s?);
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

fn args_max_hops(args: &[String]) -> Option<u32> {
    for i in 0..args.len().saturating_sub(1) {
        if args[i] == "-h" || args[i] == "-m" {
            if let Ok(v) = args[i + 1].parse::<u32>() {
                return Some(v);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn is_not_found(err: &anyhow::Error) -> bool {
    err.chain()
        .find_map(|e| e.downcast_ref::<std::io::Error>())
        .is_some_and(|e| e.kind() == ErrorKind::NotFound)
}
