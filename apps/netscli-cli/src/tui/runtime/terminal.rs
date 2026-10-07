use anyhow::Result;
#[cfg(unix)]
use crossterm::event::{DisableBracketedPaste, EnableBracketedPaste};
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

/// Give the terminal back: out of raw mode, off the alternate screen, cursor
/// shown. Safe to run twice, which happens when a panic runs it from the hook
/// and the unwind then drops [`TerminalCleanup`].
fn restore() {
    let _ = disable_raw_mode();
    let mut stdout = io::stdout();
    #[cfg(unix)]
    let _ = execute!(stdout, DisableBracketedPaste);
    let _ = execute!(stdout, DisableMouseCapture, Show, LeaveAlternateScreen);
}

/// RAII guard that restores the terminal even when the TUI exits through
/// an error or panic.
pub(super) struct TerminalCleanup;

impl Drop for TerminalCleanup {
    fn drop(&mut self) {
        restore();
    }
}

/// Run `restore` before the panic message is printed.
///
/// The message used to go to the alternate screen and was thrown away when
/// the guard left it, so a crash looked like the TUI closing by itself, with
/// exit code 101 and nothing to say why. Restoring first puts the message
/// where the user can read it.
fn install_panic_hook(restore: fn()) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        restore();
        previous(info);
    }));
}

pub(super) fn setup() -> Result<(TerminalCleanup, Terminal<CrosstermBackend<io::Stdout>>)> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    if let Err(error) = execute!(stdout, EnterAlternateScreen, Clear(ClearType::All), Hide) {
        let _ = disable_raw_mode();
        return Err(error.into());
    }
    // Bracketed paste hands a paste over as one event, so that a pasted
    // newline is text and not a keypress that runs whatever is on the line.
    // crossterm does not implement it for the legacy Windows console (its
    // `EnableBracketedPaste` returns `Unsupported` there), so it stays off on
    // Windows.
    #[cfg(unix)]
    let _ = execute!(stdout, EnableBracketedPaste);
    install_panic_hook(restore);

    let backend = CrosstermBackend::new(stdout);
    match Terminal::new(backend) {
        Ok(mut terminal) => {
            terminal.clear()?;
            Ok((TerminalCleanup, terminal))
        }
        Err(error) => {
            restore();
            Err(error.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::install_panic_hook;
    use std::sync::atomic::{AtomicBool, Ordering};

    static RESTORED: AtomicBool = AtomicBool::new(false);

    fn note_restore() {
        RESTORED.store(true, Ordering::SeqCst);
    }

    #[test]
    fn a_panic_restores_the_terminal_before_it_is_reported() {
        // The hook is process-wide, so put back whatever was there.
        let original = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        install_panic_hook(note_restore);

        let outcome = std::panic::catch_unwind(|| panic!("the TUI panicked"));

        let _ours = std::panic::take_hook();
        std::panic::set_hook(original);
        assert!(outcome.is_err());
        assert!(
            RESTORED.load(Ordering::SeqCst),
            "the terminal was not restored"
        );
    }
}
