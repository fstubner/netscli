use ratatui::{
    layout::Rect,
    style::{Color, Style},
    text::{Line, Span},
    Frame,
};

pub(in crate::tui) fn gradient_text_line_with_left_pad(
    text: &str,
    width: usize,
    left_pad: usize,
) -> Line<'static> {
    let chars: Vec<char> = text.chars().collect();
    let max = width.max(1);
    let mut spans: Vec<Span<'static>> = Vec::with_capacity(chars.len() + 1);
    if left_pad > 0 {
        spans.push(Span::raw(" ".repeat(left_pad)));
    }
    for (i, ch) in chars.into_iter().take(width).enumerate() {
        let t = if max <= 1 {
            0.0
        } else {
            (i as f32) / ((max - 1) as f32)
        };
        spans.push(Span::styled(
            ch.to_string(),
            Style::default().fg(gradient_color(t)),
        ));
    }
    Line::from(spans)
}

fn gradient_color(t: f32) -> Color {
    // Matches GUI gradient stops: #005A1E -> #0AAE7A -> #1EDCFF
    let t = t.clamp(0.0, 1.0);
    let (a, b, local) = if t <= 0.45 {
        ((0, 0x5a, 0x1e), (0x0a, 0xae, 0x7a), t / 0.45)
    } else {
        ((0x0a, 0xae, 0x7a), (0x1e, 0xdc, 0xff), (t - 0.45) / 0.55)
    };
    let lerp = |x: u8, y: u8| -> u8 {
        let xf = x as f32;
        let yf = y as f32;
        (xf + (yf - xf) * local).round().clamp(0.0, 255.0) as u8
    };
    Color::Rgb(lerp(a.0, b.0), lerp(a.1, b.1), lerp(a.2, b.2))
}

pub(in crate::tui) fn draw_gradient_rounded_border(f: &mut Frame<'_>, area: Rect) {
    if area.width < 2 || area.height < 2 {
        return;
    }

    let max_x = area.width.saturating_sub(1);
    let max_y = area.height.saturating_sub(1);
    let buf = f.buffer_mut();

    for dx in 0..area.width {
        let t = if max_x == 0 {
            0.0
        } else {
            dx as f32 / max_x as f32
        };
        let style = Style::default().fg(gradient_color(t));
        let x = area.x.saturating_add(dx);
        let top_y = area.y;
        let bottom_y = area.y.saturating_add(max_y);

        let top_ch = if dx == 0 {
            "╭"
        } else if dx == max_x {
            "╮"
        } else {
            "─"
        };
        let bottom_ch = if dx == 0 {
            "╰"
        } else if dx == max_x {
            "╯"
        } else {
            "─"
        };

        buf[(x, top_y)].set_symbol(top_ch).set_style(style);
        buf[(x, bottom_y)].set_symbol(bottom_ch).set_style(style);
    }

    for dy in 1..max_y {
        let y = area.y.saturating_add(dy);
        let left_style = Style::default().fg(gradient_color(0.0));
        let right_style = Style::default().fg(gradient_color(1.0));
        let left_x = area.x;
        let right_x = area.x.saturating_add(max_x);

        buf[(left_x, y)].set_symbol("│").set_style(left_style);
        buf[(right_x, y)].set_symbol("│").set_style(right_style);
    }
}
