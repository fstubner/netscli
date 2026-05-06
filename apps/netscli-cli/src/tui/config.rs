//! TUI in-app config screen state.
//!
//! Activated via `/config`, this is a small interactive picker that lets
//! the user toggle the bottom-status-bar's stats interface, units,
//! display interface, and display-IP preference. State lives in
//! [`ConfigUiState`]; the TuiApp's outer [`UiMode`] toggles between
//! `Normal` (history view) and `Config(ConfigUiState)`.
//!
//! Originally inline in `tui.rs`. Extracted here so the
//! "TuiApp + impl" file in `state.rs` doesn't have to carry the config
//! screen's data definitions in addition to the rendering and event
//! glue that drives them.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ConfigItemKind {
    StatsInterface,
    StatsUnit,
    DisplayInterface,
    DisplayIp,
    Reset,
    Done,
}

#[derive(Clone, Debug)]
pub(super) struct ConfigUiState {
    pub(super) selected: usize,
    pub(super) scroll: u16,
    pub(super) items: Vec<ConfigItemKind>,
    pub(super) message: Option<String>,
}

impl ConfigUiState {
    pub(super) fn new() -> Self {
        Self {
            selected: 0,
            scroll: 0,
            items: vec![
                ConfigItemKind::StatsInterface,
                ConfigItemKind::StatsUnit,
                ConfigItemKind::DisplayInterface,
                ConfigItemKind::DisplayIp,
                ConfigItemKind::Reset,
                ConfigItemKind::Done,
            ],
            message: None,
        }
    }

    pub(super) fn item(&self) -> Option<ConfigItemKind> {
        self.items.get(self.selected).copied()
    }

    pub(super) fn len(&self) -> usize {
        self.items.len()
    }

    pub(super) fn clamp_selected(&mut self) {
        if self.items.is_empty() {
            self.selected = 0;
        } else if self.selected >= self.items.len() {
            self.selected = self.items.len().saturating_sub(1);
        }
    }

    pub(super) fn ensure_visible(&mut self, selected_line: u16, viewport: u16, total: u16) {
        if viewport == 0 || total <= viewport {
            self.scroll = 0;
            return;
        }

        if selected_line < self.scroll {
            self.scroll = selected_line;
        } else if selected_line >= self.scroll.saturating_add(viewport) {
            self.scroll = selected_line.saturating_sub(viewport.saturating_sub(1));
        }

        let max_scroll = total.saturating_sub(viewport);
        self.scroll = self.scroll.min(max_scroll);
    }
}

/// Top-level UI mode toggled by `/config`. `Normal` is the default
/// scrollback + input view; `Config` shows the interactive settings
/// screen with [`ConfigUiState`] driving its selection state.
#[derive(Clone, Debug)]
pub(super) enum UiMode {
    Normal,
    Config(ConfigUiState),
}
