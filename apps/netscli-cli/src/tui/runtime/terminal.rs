use anyhow::Result;
use crossterm::{
    cursor::{Hide, Show},
    event::DisableMouseCapture,
    execute,
    terminal::{
        disable_raw_mode, enable_raw_mode, Clear, ClearType, EnterAlternateScreen,
        LeaveAlternateScreen,
    },
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
        let _ = execute!(stdout, DisableMouseCapture, Show, LeaveAlternateScreen);
    }
}

pub(super) fn setup() -> Result<(TerminalCleanup, Terminal<CrosstermBackend<io::Stdout>>)> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    if let Err(error) = execute!(stdout, EnterAlternateScreen, Clear(ClearType::All), Hide) {
        let _ = disable_raw_mode();
        return Err(error.into());
    }

    let backend = CrosstermBackend::new(stdout);
    match Terminal::new(backend) {
        Ok(mut terminal) => {
            terminal.clear()?;
            Ok((TerminalCleanup, terminal))
        }
        Err(error) => {
            let _ = disable_raw_mode();
            let mut stdout = io::stdout();
            let _ = execute!(stdout, Show, LeaveAlternateScreen);
            Err(error.into())
        }
    }
}
