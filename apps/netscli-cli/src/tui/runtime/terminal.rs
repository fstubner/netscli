use anyhow::Result;
use crossterm::{
    cursor::Show,
    event::DisableMouseCapture,
    execute,
    terminal::{disable_raw_mode, enable_raw_mode},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;

/// RAII guard that restores the terminal even when the TUI exits through
/// an error or panic.
pub(super) struct TerminalCleanup;

impl Drop for TerminalCleanup {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let mut stdout = io::stdout();
        let _ = execute!(stdout, DisableMouseCapture, Show);
    }
}

pub(super) fn setup() -> Result<(TerminalCleanup, Terminal<CrosstermBackend<io::Stdout>>)> {
    enable_raw_mode()?;
    let backend = CrosstermBackend::new(io::stdout());
    Ok((TerminalCleanup, Terminal::new(backend)?))
}
