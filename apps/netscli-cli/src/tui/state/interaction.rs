use super::super::command_catalog::{CommandDef, COMMAND_DEFS};
use super::super::history::{EntryState, HistoryEntry};
use super::TuiApp;
use netscli_core::sanitize_for_terminal;
use ratatui::text::Line;
use std::borrow::Cow;

/// Replace the characters that could drive or deceive a terminal, in every
/// span of `lines`, before they are stored.
///
/// Much of what a command prints is chosen by whatever answered it: mDNS
/// names, DNS TXT values, hop names. ratatui drops control characters when it
/// draws, but it keeps the bidi and zero-width ones, and `/export` reads
/// these stored lines, not the screen. Cleaning once, here, covers the
/// screen and both exports.
fn clean_remote_text(mut lines: Vec<Line<'static>>) -> Vec<Line<'static>> {
    for span in lines.iter_mut().flat_map(|line| line.spans.iter_mut()) {
        let cleaned = match sanitize_for_terminal(&span.content) {
            Cow::Borrowed(_) => continue,
            Cow::Owned(text) => text,
        };
        span.content = Cow::Owned(cleaned);
    }
    lines
}

impl<'a> TuiApp<'a> {
    pub fn push_command(&mut self, cmd: String) {
        self.tip_dismissed = true;
        self.confirm_exit = false;
        self.running_detail = None;
        self.scroll_to_bottom();
        self.history.push(HistoryEntry {
            command: cmd,
            output: Vec::new(),
            state: EntryState::Running,
        });
    }

    pub fn finish_current(&mut self, output: Vec<Line<'static>>) {
        if let Some(entry) = self.history.last_mut() {
            entry.output = clean_remote_text(output);
            entry.state = EntryState::Done;
        }
    }

    pub fn update_suggestions(&mut self) {
        let text = self.input.lines().join("\n");
        let trimmed = text.trim();
        if !trimmed.starts_with('/') {
            self.suggestions.clear();
            self.suggestion_index = 0;
            return;
        }

        let lower = trimmed.to_lowercase();
        let cmd_token = lower.split_whitespace().next().unwrap_or("");

        let mut matches: Vec<CommandDef> = COMMAND_DEFS
            .iter()
            .copied()
            .filter(|c| c.cmd.starts_with(cmd_token))
            .collect();

        if lower.contains(' ') {
            if let Some(def) = COMMAND_DEFS.iter().copied().find(|c| c.cmd == cmd_token) {
                matches = vec![def];
            }
        } else if matches.len() == 1 && matches[0].cmd == cmd_token {
            matches.clear();
        }

        self.suggestions = matches;
        if lower.contains(' ') || self.suggestion_index >= self.suggestions.len() {
            self.suggestion_index = 0;
        }
    }

    pub fn apply_tab_completion(&mut self) {
        let Some(choice) = self.selected_suggestion() else {
            return;
        };
        let raw = self.input.lines().join("\n");
        let trimmed = raw.trim();
        let rest = trimmed
            .char_indices()
            .find(|(_, ch)| ch.is_whitespace())
            .map(|(idx, _)| trimmed[idx..].trim())
            .unwrap_or("");

        let next = if rest.is_empty() {
            choice.cmd.to_string()
        } else {
            format!("{} {}", choice.cmd, rest)
        };
        self.set_input(next);
        self.suggestions.clear();
        self.suggestion_index = 0;
    }

    pub fn navigate_suggestions(&mut self, dir: i32) {
        if self.suggestions.is_empty() {
            return;
        }
        let len = self.suggestions.len();
        let next = if dir < 0 {
            if self.suggestion_index == 0 {
                len - 1
            } else {
                self.suggestion_index - 1
            }
        } else {
            (self.suggestion_index + 1) % len
        };
        self.suggestion_index = next;
    }

    /// Navigate through command history (bash-style).
    ///
    /// `dir < 0` (Up) walks toward older entries; `dir > 0` (Down) walks
    /// toward newer ones. `history_nav` tracks the current offset from
    /// the newest entry: `Some(0)` = newest, `Some(max-1)` = oldest,
    /// `None` = live input (below the newest).
    ///
    /// Pressing Down past the newest entry restores the live input,
    /// matching how shells behave.
    pub fn navigate_history(&mut self, dir: i32) {
        if self.command_history.is_empty() {
            return;
        }
        let max = self.command_history.len();

        let new_idx: Option<usize> = match (self.history_nav, dir.cmp(&0)) {
            // No-op on dir == 0
            (_, std::cmp::Ordering::Equal) => return,
            // At live input, pressing Up → most recent entry
            (None, std::cmp::Ordering::Less) => Some(0),
            // At live input, pressing Down → stay (nothing newer to show)
            (None, std::cmp::Ordering::Greater) => return,
            // In history, pressing Up → step to older (higher index)
            (Some(i), std::cmp::Ordering::Less) => Some((i + 1).min(max - 1)),
            // In history, pressing Down past newest (idx 0) → back to live input
            (Some(0), std::cmp::Ordering::Greater) => None,
            // In history, pressing Down → step to newer (lower index)
            (Some(i), std::cmp::Ordering::Greater) => Some(i - 1),
        };

        match new_idx {
            Some(idx) => {
                self.history_nav = Some(idx);
                self.set_input(self.command_history[max - 1 - idx].clone());
            }
            None => {
                self.history_nav = None;
                self.set_input(String::new());
            }
        }
    }

    pub fn reset_history_nav(&mut self) {
        self.history_nav = None;
    }

    pub fn set_status(&mut self, msg: impl Into<String>) {
        self.status = msg.into();
    }
}
