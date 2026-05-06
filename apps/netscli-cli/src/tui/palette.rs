//! TUI color palette with light/dark terminal auto-detection.
//!
//! All palette colors are accessed via [`palette()`], which lazily picks
//! a dark or light variant based on `$COLORFGBG`. Dark is the default when
//! detection fails — the original netscli look — and the light palette uses
//! darker foregrounds so labels stay readable against white backgrounds.
use ratatui::style::Color;
use std::sync::OnceLock;

pub struct Palette {
    pub label: Color,
    pub value: Color,
    pub text: Color,
    pub tip: Color,
    pub exit: Color,
    pub args: Color,
    pub args_optional: Color,
    pub args_required: Color,
    pub args_flag: Color,
    pub desc: Color,
}

pub fn palette() -> &'static Palette {
    static P: OnceLock<Palette> = OnceLock::new();
    P.get_or_init(|| {
        if is_light_terminal() {
            // Darker foregrounds for contrast against light backgrounds.
            Palette {
                label: Color::Rgb(70, 75, 90),
                value: Color::Rgb(40, 45, 55),
                text: Color::Rgb(25, 28, 34),
                tip: Color::Rgb(180, 95, 0),
                exit: Color::Rgb(170, 30, 30),
                args: Color::Rgb(65, 75, 90),
                args_optional: Color::Rgb(100, 105, 115),
                args_required: Color::Rgb(35, 100, 80),
                args_flag: Color::Rgb(40, 90, 150),
                desc: Color::Rgb(80, 85, 95),
            }
        } else {
            Palette {
                label: Color::Rgb(95, 100, 112),
                value: Color::Rgb(170, 176, 186),
                text: Color::Rgb(215, 219, 225),
                tip: Color::Rgb(255, 165, 0),
                exit: Color::Rgb(225, 70, 70),
                args: Color::Rgb(150, 156, 168),
                args_optional: Color::Rgb(120, 126, 138),
                args_required: Color::Rgb(150, 205, 185),
                args_flag: Color::Rgb(120, 170, 210),
                desc: Color::Rgb(120, 126, 138),
            }
        }
    })
}

/// Best-effort detection of a light-background terminal via `COLORFGBG`.
///
/// The env var format is `fg;bg` or `fg;default;bg` with ANSI 8-color
/// indices. A bg of 7 (white) or 15 (bright white) indicates a light
/// theme; anything else (or absent) we treat as dark.
fn is_light_terminal() -> bool {
    std::env::var("COLORFGBG")
        .ok()
        .and_then(|v| {
            let last = v.split(';').next_back()?;
            last.trim().parse::<u8>().ok()
        })
        .is_some_and(|bg| bg == 7 || bg == 15)
}
