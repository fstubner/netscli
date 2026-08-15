//! Traffic-stats sampling and the stats line the input box renders under it.
//!
//! Split from `render/input.rs` to keep it under the maintainability cap; the
//! gate's own note named splitting the mode renderers as the next step and
//! this is the self-contained half.

use super::super::super::widgets::{label_style, value_style};
use super::super::TuiApp;
use crate::tui_settings::StatsUnit;
use ratatui::{
    style::{Color, Style},
    text::{Line, Span},
};

impl TuiApp<'_> {
    /// Sample the traffic monitor and cache the result.
    ///
    /// This used to happen inside `render_stats_lines`, i.e. from the draw
    /// path — and `get_stats` holds a mutex across a `Networks::refresh`
    /// syscall (B-10). Drawing is synchronous, so the fix is not
    /// `spawn_blocking` but moving the sample to the async event loop, which
    /// can yield around it. The draw path now only reads cached numbers.
    pub(in crate::tui) fn refresh_traffic_stats(&mut self) {
        let stats = self.monitor.get_stats();
        if stats.available {
            self.stats_upload_mbps = stats.upload_mbps;
            self.stats_download_mbps = stats.download_mbps;
            self.stats_upload_active = stats.upload_active;
            self.stats_download_active = stats.download_active;
        } else {
            self.stats_upload_mbps = 0.0;
            self.stats_download_mbps = 0.0;
            self.stats_upload_active = false;
            self.stats_download_active = false;
        }
    }

    pub(super) fn render_stats_lines(&mut self) -> (Line<'static>, Line<'static>) {
        let dot = " · ";
        let unit: StatsUnit = self.settings.stats_unit;
        let up = format!(
            "{:.2}",
            unit.scale_from_mbps(self.stats_upload_mbps).min(999.99)
        );
        let down = format!(
            "{:.2}",
            unit.scale_from_mbps(self.stats_download_mbps).min(999.99)
        );
        let unit_suffix = format!(" {}", unit.suffix());

        let left = Line::from(vec![
            Span::styled("host ", label_style()),
            Span::styled(self.hostname.clone(), value_style()),
            Span::styled(dot, label_style()),
            Span::styled("ip ", label_style()),
            Span::styled(
                self.context_address
                    .clone()
                    .unwrap_or_else(|| "n/a".to_string()),
                value_style(),
            ),
        ]);

        let up_arrow_style = if self.stats_upload_active {
            Style::default().fg(Color::Cyan)
        } else {
            label_style()
        };
        let down_arrow_style = if self.stats_download_active {
            Style::default().fg(Color::Cyan)
        } else {
            label_style()
        };
        let number_style = value_style();

        let right_spans = vec![
            Span::styled("↑ ", up_arrow_style),
            Span::styled(up, number_style),
            Span::styled(unit_suffix.clone(), label_style()),
            Span::styled(dot, label_style()),
            Span::styled("↓ ", down_arrow_style),
            Span::styled(down, number_style),
            Span::styled(unit_suffix, label_style()),
        ];

        (left, Line::from(right_spans))
    }

    /// Current spinner glyph, derived from wall time.
    ///
    /// This used to advance an index every time it was called — from the draw
    /// path (B-36). That coupled the spinner's speed to the frame rate, so it
    /// span faster on a busy redraw and stalled when nothing else forced a
    /// frame, and it made rendering mutate state. Wall time gives a constant
    /// rate regardless of how often the screen is drawn, and lets this take
    /// `&self`.
    pub(super) fn spinner_frame(&self) -> &'static str {
        if !self.running {
            return " ";
        }
        const FRAMES: [&str; 4] = ["-", "\\", "|", "/"];
        const FRAME_MS: u128 = 120;
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        FRAMES[((ms / FRAME_MS) as usize) % FRAMES.len()]
    }
}
