//! Generic TUI rendering helpers used across the TuiApp render paths.
//!
//! This facade keeps the existing `super::widgets::*` call sites stable while
//! grouping helpers by ownership: palette styles, input rendering, suggestions,
//! line layout, gradients, scrolling, and config controls.
mod config_controls;
mod gradient;
mod input;
mod lines;
mod scroll;
mod styles;
mod suggestions;

pub(super) use config_controls::{config_line, cycle_option, cycle_unit};
pub(super) use gradient::{draw_gradient_rounded_border, gradient_text_line_with_left_pad};
pub(super) use input::{
    configure_input, cursor_blink_on, input_container_height, line_with_drawn_cursor,
    placeholder_style, slice_chars, suggestion_window_start,
};
pub(super) use lines::{boxed_lines, pad_line_to_width};
pub(super) use scroll::{next_scroll_top, scrollbar_thumb};
pub(super) use styles::{label_style, value_style};
pub(super) use suggestions::{build_suggestion_line, running_message};
