use super::super::super::widgets::{label_style, scrollbar_thumb, value_style};
use super::super::TuiApp;
use ratatui::{
    layout::Rect,
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

impl<'a> TuiApp<'a> {
    pub(super) fn render_scrollbar(
        &self,
        f: &mut Frame<'_>,
        area: Rect,
        total: u16,
        viewport: u16,
        top: u16,
    ) {
        if area.width == 0 || area.height == 0 || viewport == 0 || total <= viewport {
            return;
        }

        let (thumb_top, thumb_height) = scrollbar_thumb(top, total, viewport.min(area.height));
        let track_height = viewport.min(area.height) as usize;
        let mut lines: Vec<Line<'static>> = Vec::with_capacity(track_height);
        for i in 0..track_height {
            let i = i as u16;
            let (ch, style) = if i >= thumb_top && i < thumb_top + thumb_height {
                ("█", value_style())
            } else {
                ("│", label_style())
            };
            lines.push(Line::from(Span::styled(ch, style)));
        }
        f.render_widget(Paragraph::new(lines), area);
    }
}
