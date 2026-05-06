//! TUI module: the ratatui-based interactive surface.
//!
//! - `state` — the [`TuiApp`] struct, render impl, and view widgets
//!   (the bulk of the TUI).
//! - `events` — slash-command dispatch (`/discover`, `/scan`, etc.).
//! - this file (`mod.rs`) — public entry point [`run_tui`] plus the
//!   raw-mode `TerminalCleanup` guard.
//!
//! The split lets `main.rs` carry only the CLI arg dispatch and a
//! single call to `tui::run_tui(...)`. Before the split, run_tui and
//! handle_tui_command lived in main.rs, inflating it to ~1670 lines.
mod events;
mod state;

// Re-export TUI-public types so existing call sites in main.rs and
// tui_export.rs keep working as `tui::Foo` after the directory split.
pub use state::{help_lines, EntryState, HistoryEntry, TuiApp};

use crate::commands;
use crate::tui_formatter::Formatter;
use anyhow::Result;
use crossterm::{
    cursor::Show,
    event::{self, DisableMouseCapture, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode},
};
use netscli_core::{Ops, OpsConfig, PcapCancelToken};
use ratatui::text::Line;
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::time::Instant;
use tokio::sync::watch;

/// RAII guard that restores the terminal to its pre-TUI state when
/// dropped, regardless of whether `run_tui` exits normally or panics.
/// Without this, a panic mid-render would leave the user's terminal in
/// raw mode with the cursor hidden — typing in the broken shell
/// afterwards would feel "stuck."
struct TerminalCleanup;

impl Drop for TerminalCleanup {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let mut stdout = io::stdout();
        let _ = execute!(stdout, DisableMouseCapture, Show);
    }
}

pub async fn run_tui(concurrency: usize) -> Result<()> {
    let db = commands::try_init_db().await.map(std::sync::Arc::new);
    enable_raw_mode()?;
    let stdout = io::stdout();
    // Render into the main terminal buffer so native scrollback/selection works.
    let _cleanup = TerminalCleanup;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = TuiApp::new();
    app.settings = crate::tui_settings::load_settings();
    app.apply_settings();
    let ops = Ops::new(OpsConfig {
        concurrency,
        ..Default::default()
    });
    let mut task: Option<tokio::task::JoinHandle<Vec<Line<'static>>>> = None;
    let tick_rate = std::time::Duration::from_millis(100);
    let mut last_nav_at: Option<Instant> = None;
    let mut exit_confirmed_at: Option<Instant> = None;
    let mut pcap_cancel: Option<PcapCancelToken> = None;
    let mut progress_rx: Option<watch::Receiver<String>> = None;

    loop {
        if app.confirm_exit {
            if let Some(at) = exit_confirmed_at {
                if at.elapsed() >= std::time::Duration::from_secs(3) {
                    app.confirm_exit = false;
                    app.set_status("ready");
                    exit_confirmed_at = None;
                }
            } else {
                exit_confirmed_at = Some(Instant::now());
            }
        } else {
            exit_confirmed_at = None;
        }

        if app.running {
            if let Some(rx) = &progress_rx {
                let msg = rx.borrow().clone();
                app.running_detail = if msg.trim().is_empty() {
                    None
                } else {
                    Some(msg)
                };
            } else {
                app.running_detail = None;
            }
        } else {
            app.running_detail = None;
            progress_rx = None;
        }

        app.draw(&mut terminal)?;
        if !app.running {
            app.update_suggestions();
        } else {
            app.suggestions.clear();
        }

        // If a background command finished, apply its output.
        if let Some(handle) = task.as_mut() {
            if handle.is_finished() {
                let handle = task.take().expect("task just checked as Some");
                match handle.await {
                    Ok(lines) => app.finish_current(lines),
                    Err(e) => {
                        if e.is_cancelled() {
                            app.finish_current(vec![Formatter::format_notice(
                                "Operation cancelled",
                            )]);
                        } else {
                            app.finish_current(vec![Formatter::format_error(&format!(
                                "Operation failed: {e}"
                            ))]);
                        }
                    }
                }
                app.running = false;
                app.set_status("ready");
                pcap_cancel = None;
                progress_rx = None;
            }
        }

        // Poll for input with a timeout so we can keep the UI updating while operations run.
        if event::poll(tick_rate)? {
            match event::read()? {
                Event::Resize(_, _) => {
                    // Redraw on next tick.
                }
                Event::Mouse(_) => {}
                Event::Key(key) => {
                    // Avoid double-processing keys on platforms that emit Release events.
                    if matches!(key.kind, KeyEventKind::Release) {
                        continue;
                    }

                    // Some terminals emit a Press + immediate Repeat for navigation keys.
                    // Debounce to ensure Up/Down move by 1 item.
                    if matches!(key.code, KeyCode::Up | KeyCode::Down) {
                        let now = Instant::now();
                        if last_nav_at.is_some_and(|prev| {
                            now.duration_since(prev) < std::time::Duration::from_millis(30)
                        }) {
                            continue;
                        }
                        last_nav_at = Some(now);
                    } else {
                        last_nav_at = None;
                    }

                    // While an operation is running, allow scrolling + cancel.
                    if app.running {
                        match key.code {
                            KeyCode::PageUp => app.scroll_up(6),
                            KeyCode::PageDown => app.scroll_down(6),
                            KeyCode::Home => app.scroll_up(u16::MAX),
                            KeyCode::End => app.scroll_to_bottom(),
                            _ => {}
                        }

                        let cancel = key.code == KeyCode::Esc
                            || (key.code == KeyCode::Char('c')
                                && key.modifiers.contains(KeyModifiers::CONTROL));
                        if cancel {
                            if let Some(cancel_token) = pcap_cancel.take() {
                                cancel_token.cancel();
                                if let Some(handle) = task.take() {
                                    match handle.await {
                                        Ok(lines) => app.finish_current(lines),
                                        Err(e) => {
                                            app.finish_current(vec![Formatter::format_error(
                                                &format!("Operation failed: {e}"),
                                            )])
                                        }
                                    }
                                }
                                app.running = false;
                                app.set_status("ready");
                                progress_rx = None;
                            } else if let Some(handle) = task.take() {
                                handle.abort();
                                let _ = handle.await;
                                app.running = false;
                                app.set_status("cancelled");
                                progress_rx = None;
                                app.finish_current(vec![Formatter::format_notice(
                                    "Operation cancelled",
                                )]);
                            }
                        }
                        continue;
                    }

                    if app.is_config_mode() {
                        match key.code {
                            KeyCode::Esc => {
                                app.exit_config();
                            }
                            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                                app.exit_config();
                            }
                            KeyCode::Up => app.config_prev(),
                            KeyCode::Down => app.config_next(),
                            KeyCode::Left => app.config_cycle(-1),
                            KeyCode::Right => app.config_cycle(1),
                            KeyCode::Enter => {
                                if app.config_activate() {
                                    app.exit_config();
                                }
                            }
                            KeyCode::PageUp => {
                                for _ in 0..4 {
                                    app.config_prev();
                                }
                            }
                            KeyCode::PageDown => {
                                for _ in 0..4 {
                                    app.config_next();
                                }
                            }
                            _ => {}
                        }
                        continue;
                    }

                    let is_ctrl_c = key.code == KeyCode::Char('c')
                        && key.modifiers.contains(KeyModifiers::CONTROL);
                    let is_exit_key = key.code == KeyCode::Esc || is_ctrl_c;

                    // Any non-exit key clears the exit-confirm prompt.
                    if app.confirm_exit && !is_exit_key {
                        app.confirm_exit = false;
                        app.set_status("ready");
                        exit_confirmed_at = None;
                    }

                    match key.code {
                        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            if app.confirm_exit {
                                break;
                            } else {
                                app.confirm_exit = true;
                                app.set_status("Press Esc or Ctrl+C again to exit");
                                exit_confirmed_at = Some(Instant::now());
                            }
                        }
                        KeyCode::Esc => {
                            if app.confirm_exit {
                                break;
                            } else {
                                app.confirm_exit = true;
                                app.set_status("Press Esc or Ctrl+C again to exit");
                                exit_confirmed_at = Some(Instant::now());
                            }
                        }
                        KeyCode::Tab => {
                            app.apply_tab_completion();
                        }
                        KeyCode::PageUp => app.scroll_up(6),
                        KeyCode::PageDown => app.scroll_down(6),
                        KeyCode::Home if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            app.scroll_up(u16::MAX)
                        }
                        KeyCode::End if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            app.scroll_to_bottom()
                        }
                        KeyCode::Up => {
                            let input = app.input.lines().join("\n");
                            let cmd = input.split_whitespace().next().unwrap_or("");
                            if !app.suggestions.is_empty() && !app.is_exact_command(cmd) {
                                app.navigate_suggestions(-1);
                            } else {
                                app.navigate_history(-1);
                            }
                        }
                        KeyCode::Down => {
                            let input = app.input.lines().join("\n");
                            let cmd = input.split_whitespace().next().unwrap_or("");
                            if !app.suggestions.is_empty() && !app.is_exact_command(cmd) {
                                app.navigate_suggestions(1);
                            } else {
                                app.navigate_history(1);
                            }
                        }
                        KeyCode::Enter => {
                            let raw = app.input.lines().join("\n");
                            let trimmed = raw.trim();
                            if !trimmed.is_empty() {
                                let mut input = trimmed.to_string();
                                if !app.suggestions.is_empty()
                                    && !trimmed.contains(' ')
                                    && trimmed.starts_with('/')
                                    && !app.is_exact_command(trimmed)
                                {
                                    if let Some(s) = app.selected_suggestion() {
                                        input = s.cmd.to_string();
                                    }
                                }

                                let first = input.split_whitespace().next().unwrap_or("");
                                if first == "/quit" || first == "/exit" {
                                    // Graceful shutdown: break so we can restore terminal state.
                                    break;
                                }

                                if first == "/config" {
                                    app.confirm_exit = false;
                                    app.set_status("ready");
                                    app.enter_config();
                                    app.reset_input();
                                    app.reset_history_nav();
                                    app.suggestions.clear();
                                    app.suggestion_index = 0;
                                    continue;
                                }

                                if first == "/export" {
                                    let snapshot = app.history.clone();
                                    let result = crate::tui_export::parse_export_command(&input)
                                        .and_then(|req| {
                                            crate::tui_export::export_session(&snapshot, &req)
                                        });

                                    app.confirm_exit = false;
                                    app.set_status("ready");
                                    app.push_command(input.clone());
                                    // Skip duplicate consecutive history entries so
                                    // repeated Enter presses don't bloat Up/Down nav.
                                    if app.command_history.last() != Some(&input) {
                                        app.command_history.push(input.clone());
                                    }
                                    app.reset_input();
                                    app.reset_history_nav();
                                    app.suggestions.clear();
                                    app.suggestion_index = 0;

                                    let lines = match result {
                                        Ok(path) => vec![Line::from(format!(
                                            "Exported to {}",
                                            path.display()
                                        ))],
                                        Err(e) => vec![
                                            Formatter::format_error(&format!("{e}")),
                                            Line::from(
                                                "Usage: /export [md|json] [--output <path>]",
                                            ),
                                        ],
                                    };
                                    app.finish_current(lines);
                                    continue;
                                }

                                app.confirm_exit = false;
                                app.running = true;
                                app.set_status("Running...");
                                app.push_command(input.clone());
                                if app.command_history.last() != Some(&input) {
                                    app.command_history.push(input.clone());
                                }
                                app.reset_input();
                                app.reset_history_nav();
                                app.suggestions.clear();
                                app.suggestion_index = 0;

                                let ops = ops.clone();
                                let db = db.clone();
                                let (progress_tx, rx) = watch::channel(String::new());
                                progress_rx = Some(rx);
                                let pcap_cancel_for_task = if first == "/pcap" {
                                    let token = PcapCancelToken::new();
                                    pcap_cancel = Some(token.clone());
                                    Some(token)
                                } else {
                                    pcap_cancel = None;
                                    None
                                };
                                task = Some(tokio::spawn(async move {
                                    events::handle_command(
                                        input,
                                        &ops,
                                        db.as_deref(),
                                        pcap_cancel_for_task,
                                        Some(progress_tx),
                                    )
                                    .await
                                }));
                            }
                        }
                        _ => {
                            app.input.input(key);
                            app.reset_history_nav();
                            app.suggestion_index = 0;
                            app.confirm_exit = false;
                        }
                    }
                }
                _ => {}
            };
        }
    }

    Ok(())
}
