//! `NO_COLOR` for the terminal UI.
//!
//! The CLI's tables have always honoured it, and the TUI did not: it drew in
//! 24-bit colour whatever the environment said. Colour is set in a hundred
//! places across the formatters, so rather than thread a switch through all of
//! them the finished frame is stripped.

use ratatui::buffer::Buffer;
use ratatui::style::{Color, Modifier};
use std::sync::OnceLock;

/// Whether the user asked for no colour. Read once, as the CLI does.
pub(super) fn no_color() -> bool {
    static NO_COLOR: OnceLock<bool> = OnceLock::new();
    *NO_COLOR.get_or_init(|| std::env::var_os("NO_COLOR").is_some())
}

/// Take the colour out of a drawn frame and keep what else a cell says, such
/// as bold. A cell that had a background, which is how the selected row in
/// `/config` shows, is reversed instead, so the selection is still visible.
pub(super) fn strip_colour(buffer: &mut Buffer) {
    for cell in &mut buffer.content {
        if cell.bg != Color::Reset {
            cell.modifier.insert(Modifier::REVERSED);
        }
        cell.fg = Color::Reset;
        cell.bg = Color::Reset;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::layout::Rect;
    use ratatui::style::Style;

    #[test]
    fn colour_goes_and_emphasis_stays() {
        let mut buffer = Buffer::empty(Rect::new(0, 0, 3, 1));
        buffer[(0, 0)].set_style(Style::default().fg(Color::Rgb(1, 2, 3)));
        buffer[(1, 0)].set_style(Style::default().fg(Color::Red).add_modifier(Modifier::BOLD));
        buffer[(2, 0)].set_style(Style::default().bg(Color::Rgb(52, 56, 64)));

        strip_colour(&mut buffer);

        for x in 0..3 {
            assert_eq!(buffer[(x, 0)].fg, Color::Reset);
            assert_eq!(buffer[(x, 0)].bg, Color::Reset);
        }
        assert!(buffer[(1, 0)].modifier.contains(Modifier::BOLD));
        // The selected row keeps showing, as a reversed one.
        assert!(buffer[(2, 0)].modifier.contains(Modifier::REVERSED));
        assert!(!buffer[(0, 0)].modifier.contains(Modifier::REVERSED));
    }
}
