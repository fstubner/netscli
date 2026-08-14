use crate::tui::{EntryState, HistoryEntry};
use anyhow::Result;
use chrono::Local;
use dirs::home_dir;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Markdown,
    Json,
}

impl ExportFormat {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "md" | "markdown" => Some(Self::Markdown),
            "json" => Some(Self::Json),
            _ => None,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::Json => "json",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExportRequest {
    pub format: ExportFormat,
    pub output: Option<PathBuf>,
}

pub fn parse_export_command(input: &str) -> Result<ExportRequest> {
    // Use shell-words so paths with spaces work when quoted:
    //   /export --output "C:\Users\Me\My Scans\out.md"
    // Plain whitespace-split would have made this impossible.
    let parts = shell_words::split(input)
        .map_err(|e| anyhow::anyhow!("Could not parse /export arguments: {e}"))?;
    let mut format = ExportFormat::Markdown;
    let mut output: Option<PathBuf> = None;

    let mut i = 1usize;
    while i < parts.len() {
        let tok = parts[i].as_str();
        match tok {
            "--output" | "-o" => {
                let Some(path) = parts.get(i + 1) else {
                    anyhow::bail!("Missing value for --output");
                };
                output = Some(PathBuf::from(path));
                i += 2;
            }
            t if t.starts_with('-') => {
                anyhow::bail!("Unknown flag: {t}");
            }
            t => {
                if let Some(f) = ExportFormat::parse(t) {
                    format = f;
                } else {
                    anyhow::bail!("Unknown format: {t} (expected md|json)");
                }
                i += 1;
            }
        }
    }

    Ok(ExportRequest { format, output })
}

pub fn export_session(history: &[HistoryEntry], req: &ExportRequest) -> Result<PathBuf> {
    let explicit = req.output.is_some();
    let path = req
        .output
        .clone()
        .unwrap_or_else(|| default_output_path(req.format));

    // Refuse to clobber an existing file (B-13).
    //
    // `/export -o ~/.bashrc` used to overwrite it with no confirmation and no
    // --force. The generated default path is timestamped to the second and is
    // ours by construction, so only a user-supplied path needs the guard.
    if explicit && path.exists() {
        anyhow::bail!(
            "{} already exists. Choose another path, or delete it first.",
            path.display()
        );
    }

    // Only create directories the user actually asked for. This used to run
    // for the default path too, materialising trees as a side effect.
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    match req.format {
        ExportFormat::Markdown => fs::write(&path, render_markdown(history))?,
        ExportFormat::Json => fs::write(&path, render_json(history)?)?,
    }

    Ok(path)
}

fn default_output_path(format: ExportFormat) -> PathBuf {
    let ts = Local::now().format("%Y%m%d-%H%M%S");
    let base = home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".netscli")
        .join("exports");
    base.join(format!("netscli-session-{ts}.{}", format.extension()))
}

fn render_markdown(history: &[HistoryEntry]) -> String {
    let mut out = String::new();
    let ts = Local::now().to_rfc3339();
    out.push_str("# netscli session\n\n");
    out.push_str(&format!("Generated: {ts}\n\n"));

    for entry in history.iter().filter(|e| e.state == EntryState::Done) {
        // Escape backticks in the command header so they don't break the
        // surrounding inline-code span.
        let cmd_escaped = entry.command.trim().replace('`', "\\`");
        out.push_str(&format!("## `{cmd_escaped}`\n\n"));

        // Choose a fence that doesn't appear in the output. CommonMark
        // allows any backtick run of ≥3, so we pick the shortest run
        // not present in the body. This prevents embedded ``` in user
        // output from prematurely closing the fence.
        let body: String = entry
            .output
            .iter()
            .map(|l| {
                let mut s = l.to_string();
                s.push('\n');
                s
            })
            .collect();
        let fence = choose_markdown_fence(&body);
        out.push_str(&fence);
        out.push_str("text\n");
        out.push_str(&body);
        out.push_str(&fence);
        out.push_str("\n\n");
    }
    out
}

/// Return a backtick fence longer than any run of backticks in `body`.
fn choose_markdown_fence(body: &str) -> String {
    let mut max_run = 0usize;
    let mut current = 0usize;
    for ch in body.chars() {
        if ch == '`' {
            current += 1;
            if current > max_run {
                max_run = current;
            }
        } else {
            current = 0;
        }
    }
    let len = (max_run + 1).max(3);
    "`".repeat(len)
}

#[derive(Serialize)]
struct ExportEntry {
    command: String,
    output: Vec<String>,
}

#[derive(Serialize)]
struct ExportDoc {
    generated: String,
    entries: Vec<ExportEntry>,
}

fn render_json(history: &[HistoryEntry]) -> Result<String> {
    let doc = ExportDoc {
        generated: Local::now().to_rfc3339(),
        entries: history
            .iter()
            .filter(|e| e.state == EntryState::Done)
            .map(|e| ExportEntry {
                command: e.command.clone(),
                output: e.output.iter().map(|l| l.to_string()).collect(),
            })
            .collect(),
    };
    Ok(serde_json::to_string_pretty(&doc)?)
}
