use super::super::super::palette::palette;
use super::super::super::widgets::{label_style, value_style};
use super::super::TuiApp;
use ratatui::{
    layout::Rect,
    style::Style,
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Padding, Paragraph, Wrap},
    Frame,
};

impl<'a> TuiApp<'a> {
    pub(super) fn message_height(&self) -> u16 {
        if self.confirm_exit {
            3
        } else {
            0
        }
    }

    pub(super) fn render_message(&mut self, f: &mut Frame<'_>, area: Rect) {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(label_style())
            .padding(Padding::horizontal(1));
        let inner = block.inner(area);
        f.render_widget(block, area);

        if !self.confirm_exit {
            return;
        }

        let line = Line::from(vec![
            Span::styled("Exit", Style::default().fg(palette().exit)),
            Span::styled(" · ", label_style()),
            Span::styled(
                "Press Esc or Ctrl+C again to exit.".to_string(),
                value_style(),
            ),
        ]);
        f.render_widget(Paragraph::new(line).wrap(Wrap { trim: false }), inner);
    }
}
