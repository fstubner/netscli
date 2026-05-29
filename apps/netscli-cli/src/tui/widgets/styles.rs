use super::super::palette::palette;
use ratatui::style::Style;

pub(in crate::tui) fn label_style() -> Style {
    Style::default().fg(palette().label)
}

pub(in crate::tui) fn value_style() -> Style {
    Style::default().fg(palette().value)
}

pub(super) fn placeholder_style() -> Style {
    // Use a mid-gray so the placeholder stays readable without overpowering the UI.
    Style::default().fg(palette().args)
}
