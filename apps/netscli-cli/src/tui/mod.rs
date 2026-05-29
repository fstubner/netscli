//! TUI module: the ratatui-based interactive surface.
//!
//! - `state` owns [`TuiApp`] and view-specific state.
//! - `events` dispatches slash commands such as `/discover` and `/scan`.
//! - `runtime` owns terminal setup, key handling, and background task lifecycle.
//! - `widgets` contains reusable ratatui rendering helpers.
mod command_catalog;
mod config;
mod events;
mod history;
mod palette;
mod runtime;
mod state;
mod widgets;

// Re-export TUI-public types so existing call sites in main.rs and
// tui_export.rs keep working as `tui::Foo` after the directory split.
pub use command_catalog::help_lines;
pub use history::{EntryState, HistoryEntry};
pub use runtime::run_tui;
