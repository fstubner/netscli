//! TUI history entry types.
//!
//! Each line the user submits creates a [`HistoryEntry`]; the entry's
//! [`EntryState`] tracks whether the underlying command is still running
//! (so the spinner keeps animating) or has completed (so the output is
//! frozen and no further updates apply). Used by the TuiApp scrollback
//! and by `tui_export.rs` when rendering session output to disk.
use ratatui::text::Line;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryState {
    Running,
    Done,
}

#[derive(Clone, Debug)]
pub struct HistoryEntry {
    pub command: String,
    pub output: Vec<Line<'static>>,
    pub state: EntryState,
}
