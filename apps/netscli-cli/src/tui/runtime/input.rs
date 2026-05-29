use super::{tasks::TaskRuntime, SharedDb};
use crate::tui_formatter::Formatter;
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use netscli_core::Ops;
use ratatui::text::Line;
use std::time::{Duration, Instant};

use super::super::state::TuiApp;

pub(super) struct InputRuntime {
    last_nav_at: Option<Instant>,
    exit_confirmed_at: Option<Instant>,
}

impl InputRuntime {
    pub(super) fn new() -> Self {
        Self {
            last_nav_at: None,
            exit_confirmed_at: None,
        }
    }

    pub(super) fn refresh_exit_confirmation(&mut self, app: &mut TuiApp<'_>) {
        if app.confirm_exit {
            if let Some(at) = self.exit_confirmed_at {
                if at.elapsed() >= Duration::from_secs(3) {
                    app.confirm_exit = false;
                    app.set_status("ready");
                    self.exit_confirmed_at = None;
                }
            } else {
                self.exit_confirmed_at = Some(Instant::now());
            }
        } else {
            self.exit_confirmed_at = None;
        }
    }

    pub(super) async fn handle_key(
        &mut self,
        key: KeyEvent,
        app: &mut TuiApp<'_>,
        tasks: &mut TaskRuntime,
        ops: &Ops,
        db: &SharedDb,
    ) -> Result<bool> {
        if matches!(key.kind, KeyEventKind::Release) || self.should_debounce_nav(key.code) {
            return Ok(false);
        }

        if app.running {
            self.handle_running_key(key, app, tasks).await;
            return Ok(false);
        }

        if app.is_config_mode() {
            self.handle_config_key(key, app);
            return Ok(false);
        }

        let is_ctrl_c =
            key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL);
        let is_exit_key = key.code == KeyCode::Esc || is_ctrl_c;
        if app.confirm_exit && !is_exit_key {
            app.confirm_exit = false;
            app.set_status("ready");
            self.exit_confirmed_at = None;
        }

        match key.code {
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                Ok(self.confirm_or_exit(app))
            }
            KeyCode::Esc => Ok(self.confirm_or_exit(app)),
            KeyCode::Tab => {
                app.apply_tab_completion();
                Ok(false)
            }
            KeyCode::PageUp => {
                app.scroll_up(6);
                Ok(false)
            }
            KeyCode::PageDown => {
                app.scroll_down(6);
                Ok(false)
            }
            KeyCode::Home if key.modifiers.contains(KeyModifiers::CONTROL) => {
                app.scroll_up(u16::MAX);
                Ok(false)
            }
            KeyCode::End if key.modifiers.contains(KeyModifiers::CONTROL) => {
                app.scroll_to_bottom();
                Ok(false)
            }
            KeyCode::Up => {
                self.navigate_input(app, -1);
                Ok(false)
            }
            KeyCode::Down => {
                self.navigate_input(app, 1);
                Ok(false)
            }
            KeyCode::Enter => self.submit_command(app, tasks, ops, db).await,
            _ => {
                app.input.input(key);
                app.reset_history_nav();
                app.suggestion_index = 0;
                app.confirm_exit = false;
                Ok(false)
            }
        }
    }

    fn should_debounce_nav(&mut self, code: KeyCode) -> bool {
        if !matches!(code, KeyCode::Up | KeyCode::Down) {
            self.last_nav_at = None;
            return false;
        }

        let now = Instant::now();
        let debounce = self
            .last_nav_at
            .is_some_and(|prev| now.duration_since(prev) < Duration::from_millis(30));
        self.last_nav_at = Some(now);
        debounce
    }

    async fn handle_running_key(
        &mut self,
        key: KeyEvent,
        app: &mut TuiApp<'_>,
        tasks: &mut TaskRuntime,
    ) {
        match key.code {
            KeyCode::PageUp => app.scroll_up(6),
            KeyCode::PageDown => app.scroll_down(6),
            KeyCode::Home => app.scroll_up(u16::MAX),
            KeyCode::End => app.scroll_to_bottom(),
            _ => {}
        }

        let cancel = key.code == KeyCode::Esc
            || (key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL));
        if cancel {
            tasks.cancel_running(app).await;
        }
    }

    fn handle_config_key(&mut self, key: KeyEvent, app: &mut TuiApp<'_>) {
        match key.code {
            KeyCode::Esc => app.exit_config(),
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
    }

    fn confirm_or_exit(&mut self, app: &mut TuiApp<'_>) -> bool {
        if app.confirm_exit {
            true
        } else {
            app.confirm_exit = true;
            app.set_status("Press Esc or Ctrl+C again to exit");
            self.exit_confirmed_at = Some(Instant::now());
            false
        }
    }

    fn navigate_input(&mut self, app: &mut TuiApp<'_>, delta: i32) {
        let input = app.input.lines().join("\n");
        let cmd = input.split_whitespace().next().unwrap_or("");
        if !app.suggestions.is_empty() && !app.is_exact_command(cmd) {
            app.navigate_suggestions(delta);
        } else {
            app.navigate_history(delta);
        }
    }

    async fn submit_command(
        &mut self,
        app: &mut TuiApp<'_>,
        tasks: &mut TaskRuntime,
        ops: &Ops,
        db: &SharedDb,
    ) -> Result<bool> {
        let raw = app.input.lines().join("\n");
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Ok(false);
        }

        let input = self.resolve_submission(app, trimmed);
        let first = input.split_whitespace().next().unwrap_or("").to_string();
        if first == "/quit" || first == "/exit" {
            return Ok(true);
        }

        if first == "/config" {
            self.enter_config(app);
            return Ok(false);
        }

        if first == "/export" {
            self.export_session(app, input);
            return Ok(false);
        }

        self.start_command(app, tasks, ops, db, input, &first);
        Ok(false)
    }

    fn resolve_submission(&self, app: &TuiApp<'_>, trimmed: &str) -> String {
        if !app.suggestions.is_empty()
            && !trimmed.contains(' ')
            && trimmed.starts_with('/')
            && !app.is_exact_command(trimmed)
        {
            if let Some(s) = app.selected_suggestion() {
                return s.cmd.to_string();
            }
        }
        trimmed.to_string()
    }

    fn enter_config(&mut self, app: &mut TuiApp<'_>) {
        app.confirm_exit = false;
        app.set_status("ready");
        app.enter_config();
        Self::clear_input_state(app);
    }

    fn export_session(&mut self, app: &mut TuiApp<'_>, input: String) {
        let snapshot = app.history.clone();
        let result = crate::tui_export::parse_export_command(&input)
            .and_then(|req| crate::tui_export::export_session(&snapshot, &req));

        app.confirm_exit = false;
        app.set_status("ready");
        app.push_command(input.clone());
        Self::remember_command(app, &input);
        Self::clear_input_state(app);

        let lines = match result {
            Ok(path) => vec![Line::from(format!("Exported to {}", path.display()))],
            Err(e) => vec![
                Formatter::format_error(&format!("{e}")),
                Line::from("Usage: /export [md|json] [--output <path>]"),
            ],
        };
        app.finish_current(lines);
    }

    fn start_command(
        &mut self,
        app: &mut TuiApp<'_>,
        tasks: &mut TaskRuntime,
        ops: &Ops,
        db: &SharedDb,
        input: String,
        first: &str,
    ) {
        app.confirm_exit = false;
        app.running = true;
        app.set_status("Running...");
        app.push_command(input.clone());
        Self::remember_command(app, &input);
        Self::clear_input_state(app);
        tasks.spawn_command(input, first, ops, db);
    }

    fn remember_command(app: &mut TuiApp<'_>, input: &str) {
        if app.command_history.last().is_none_or(|last| last != input) {
            app.command_history.push(input.to_string());
        }
    }

    fn clear_input_state(app: &mut TuiApp<'_>) {
        app.reset_input();
        app.reset_history_nav();
        app.suggestions.clear();
        app.suggestion_index = 0;
    }
}
