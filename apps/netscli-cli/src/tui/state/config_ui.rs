use super::TuiApp;
use crate::tui::config::{ConfigItemKind, ConfigUiState, UiMode};
use crate::tui::widgets::{cycle_option, cycle_unit};
use crate::tui_settings::MAX_CONCURRENT_PROBE_OPTIONS;
use netscli_core::NetworkManager;

impl<'a> TuiApp<'a> {
    pub fn is_config_mode(&self) -> bool {
        matches!(self.ui_mode, UiMode::Config(_))
    }

    pub fn enter_config(&mut self) {
        self.ui_mode = UiMode::Config(ConfigUiState::new());
        self.scroll_from_bottom = 0;
    }

    pub fn exit_config(&mut self) {
        self.ui_mode = UiMode::Normal;
        self.scroll_to_bottom();
    }

    pub fn config_next(&mut self) {
        let Some(state) = self.config_state_mut() else {
            return;
        };
        state.clamp_selected();
        if state.len() == 0 {
            return;
        }
        state.selected = (state.selected + 1).min(state.len().saturating_sub(1));
    }

    pub fn config_prev(&mut self) {
        let Some(state) = self.config_state_mut() else {
            return;
        };
        if state.len() == 0 {
            return;
        }
        state.selected = state.selected.saturating_sub(1);
    }

    pub fn config_cycle(&mut self, dir: i32) {
        let item = {
            let Some(state) = self.config_state_mut() else {
                return;
            };
            state.message = None;
            state.item()
        };

        let Some(item) = item else {
            return;
        };

        match item {
            ConfigItemKind::MaxConcurrentProbes => {
                let options = MAX_CONCURRENT_PROBE_OPTIONS;
                let current = self.settings.max_concurrent_probes;
                let idx = options
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, value)| value.abs_diff(current))
                    .map(|(index, _)| index)
                    .unwrap_or(3);
                let next = if dir < 0 {
                    if idx == 0 {
                        options.len() - 1
                    } else {
                        idx - 1
                    }
                } else {
                    (idx + 1) % options.len()
                };
                self.settings.max_concurrent_probes = options[next];
                self.concurrency_override = None;
            }
            ConfigItemKind::StatsInterface => {
                let next = cycle_option(
                    self.settings.stats_interface.as_deref(),
                    &self.config_stats_interface_options(),
                    dir,
                );
                self.settings.stats_interface = next;
                self.apply_settings();
            }
            ConfigItemKind::StatsUnit => {
                self.settings.stats_unit = cycle_unit(self.settings.stats_unit, dir);
                self.apply_settings();
            }
            ConfigItemKind::DisplayInterface => {
                let next = cycle_option(
                    self.settings.display_interface.as_deref(),
                    &self.config_display_interface_options(),
                    dir,
                );
                self.settings.display_interface = next;
                self.settings.display_ip = None;
                self.apply_settings();
            }
            ConfigItemKind::DisplayIp => {
                let next = cycle_option(
                    self.settings.display_ip.as_deref(),
                    &self.config_display_ip_options(),
                    dir,
                );
                self.settings.display_ip = next;
                self.settings.display_interface = None;
                self.apply_settings();
            }
            ConfigItemKind::Reset | ConfigItemKind::Done => {}
        }

        let msg = self.config_save_settings();
        if let Some(state) = self.config_state_mut() {
            state.message = msg;
        }
    }

    pub fn config_activate(&mut self) -> bool {
        let item = {
            let Some(state) = self.config_state_mut() else {
                return false;
            };
            state.message = None;
            state.item()
        };

        let Some(item) = item else {
            return false;
        };

        let exit = match item {
            ConfigItemKind::Reset => {
                self.settings = crate::tui_settings::TuiSettings::default();
                self.apply_settings();
                false
            }
            ConfigItemKind::Done => true,
            _ => false,
        };

        let msg = self.config_save_settings();
        if let Some(state) = self.config_state_mut() {
            state.message = msg;
        }
        exit
    }

    pub(super) fn config_state_mut(&mut self) -> Option<&mut ConfigUiState> {
        match &mut self.ui_mode {
            UiMode::Config(state) => Some(state),
            UiMode::Normal => None,
        }
    }

    fn config_save_settings(&self) -> Option<String> {
        if let Err(e) = crate::tui_settings::save_settings(&self.settings) {
            return Some(format!("Failed to save settings: {e}"));
        }
        None
    }

    fn config_stats_interface_options(&self) -> Vec<String> {
        let mut options = self.monitor.available_interfaces();
        options.sort_unstable();
        options
    }

    fn config_display_interface_options(&self) -> Vec<String> {
        let mut options: Vec<String> = NetworkManager::get_interfaces()
            .into_iter()
            .map(|i| i.name)
            .collect();
        options.sort_unstable();
        options
    }

    fn config_display_ip_options(&self) -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        let mut options = Vec::new();
        for iface in NetworkManager::get_interfaces() {
            for net in iface.ips {
                if let std::net::IpAddr::V4(v4) = net.addr() {
                    let ip = v4.to_string();
                    if seen.insert(ip.clone()) {
                        options.push(ip);
                    }
                }
            }
        }
        options.sort_unstable();
        options
    }
}
