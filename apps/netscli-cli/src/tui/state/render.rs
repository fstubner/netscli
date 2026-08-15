use super::super::widgets::input_container_height;
use super::TuiApp;
use ratatui::{
    backend::Backend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    text::Line,
    widgets::Paragraph,
    Frame, Terminal,
};

mod config_panel;
mod content;
mod input;
mod message;
mod scrollbar;
mod stats;

impl<'a> TuiApp<'a> {
    pub fn draw<B: Backend>(&mut self, terminal: &mut Terminal<B>) -> Result<(), B::Error> {
        terminal.draw(|f| self.draw_frame(f))?;
        Ok(())
    }

    fn draw_frame(&mut self, f: &mut Frame<'_>) {
        let margin = if f.area().width >= 80 { 3 } else { 1 };

        let outer = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Length(margin),
                Constraint::Min(1),
                Constraint::Length(margin),
            ])
            .split(f.area());
        let content = outer[1];
        let content_width = content.width;

        let message_height = self.message_height();
        let requested_input_height = input_container_height(self.suggestions.len());
        // Keep at least a sliver of output visible (banner/history scroll area) even if the
        // terminal is short and the autocomplete wants extra height.
        let min_output_h = 1u16;
        let available_after_message = content.height.saturating_sub(message_height);
        let max_input_h = if available_after_message > min_output_h {
            available_after_message - min_output_h
        } else {
            available_after_message
        };

        let input_h = requested_input_height.min(max_input_h.max(1));
        let mut remaining = content.height.saturating_sub(input_h);
        let message_h = message_height.min(remaining);
        remaining = remaining.saturating_sub(message_h);
        let output_h = remaining;

        let output_area = Rect {
            x: content.x,
            y: content.y,
            width: content.width,
            height: output_h,
        };
        let message_area = Rect {
            x: content.x,
            y: content.y.saturating_add(output_h),
            width: content.width,
            height: message_h,
        };
        let input_area = Rect {
            x: content.x,
            y: content.y.saturating_add(output_h).saturating_add(message_h),
            width: content.width,
            height: input_h,
        };

        let scroll_area = Rect {
            x: outer[2].x.saturating_add(outer[2].width.saturating_sub(1)),
            y: output_area.y,
            width: outer[2].width.min(1),
            height: output_area.height,
        };

        if self.is_config_mode() {
            self.render_config(f, output_area, content_width, scroll_area);
        } else {
            self.render_output(f, output_area, content_width, scroll_area);
        }
        if message_h > 0 {
            self.render_message(f, message_area);
        }
        self.render_input(f, input_area);
    }

    fn render_output(&mut self, f: &mut Frame<'_>, area: Rect, content_width: u16, scroll: Rect) {
        if area.width == 0 || area.height == 0 {
            return;
        }
        let viewport = area.height;
        let mut lines = self.build_scroll_lines(content_width);
        let mut total = (lines.len()).min(u16::MAX as usize) as u16;

        // Splash layout: when only the header/tip are shown, bottom-align them so the tip
        // sits close to the fixed input box (reduces the huge empty gap on tall terminals).
        if self.history.is_empty()
            && self.should_show_tip()
            && self.scroll_from_bottom == 0
            && total < viewport
        {
            let pad = (viewport - total) as usize;
            let mut padded = Vec::with_capacity(lines.len() + pad);
            padded.extend(std::iter::repeat_n(Line::default(), pad));
            padded.extend(lines);
            lines = padded;
            total = viewport;
        }

        let max_from_bottom = total.saturating_sub(viewport);
        self.scroll_from_bottom = self.scroll_from_bottom.min(max_from_bottom);
        let top = max_from_bottom.saturating_sub(self.scroll_from_bottom);

        let para = Paragraph::new(lines)
            .scroll((top, 0))
            .alignment(Alignment::Left);
        f.render_widget(para, area);

        self.render_scrollbar(f, scroll, total, viewport, top);
    }

    fn render_config(&mut self, f: &mut Frame<'_>, area: Rect, content_width: u16, scroll: Rect) {
        if area.width == 0 || area.height == 0 {
            return;
        }
        let state_snapshot = {
            let Some(state) = self.config_state_mut() else {
                return;
            };
            state.clamp_selected();
            state.clone()
        };

        let viewport = area.height;
        let (lines, item_lines) = self.build_config_lines(content_width, &state_snapshot);
        let total = (lines.len()).min(u16::MAX as usize) as u16;
        let selected_line = item_lines
            .get(state_snapshot.selected)
            .copied()
            .unwrap_or(0)
            .min(total.saturating_sub(1) as usize) as u16;
        if let Some(state) = self.config_state_mut() {
            state.ensure_visible(selected_line, viewport, total);
        }

        let max_scroll = total.saturating_sub(viewport);
        let top = self
            .config_state_mut()
            .map(|state| state.scroll.min(max_scroll))
            .unwrap_or(0);
        let para = Paragraph::new(lines)
            .scroll((top, 0))
            .alignment(Alignment::Left);
        f.render_widget(para, area);
        self.render_scrollbar(f, scroll, total, viewport, top);
    }
}
