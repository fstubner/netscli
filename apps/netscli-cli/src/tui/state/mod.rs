use super::command_catalog::{CommandDef, COMMAND_DEFS};
use super::config::{ConfigItemKind, ConfigUiState, UiMode};
use super::history::HistoryEntry;
use super::widgets::{configure_input, cycle_option, cycle_unit};
use crate::tui_settings::TuiSettings;
use netscli_core::{NetworkManager, NetworkMonitor};
use ratatui_textarea::{CursorMove, TextArea};
use std::time::{SystemTime, UNIX_EPOCH};

mod interaction;
mod render;
#[cfg(test)]
mod tests;

const ANSI_SHADOW_BANNER: [&str; 6] = [
    "███╗   ██╗███████╗████████╗███████╗ ██████╗██╗     ██╗",
    "████╗  ██║██╔════╝╚══██╔══╝██╔════╝██╔════╝██║     ██║",
    "██╔██╗ ██║█████╗     ██║   ███████╗██║     ██║     ██║",
    "██║╚██╗██║██╔══╝     ██║   ╚════██║██║     ██║     ██║",
    "██║ ╚████║███████╗   ██║   ███████║╚██████╗███████╗██║",
    "╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚══════╝ ╚═════╝╚══════╝╚═╝",
];

const TAGLINE: &str = "A modern network scanner.";
const INPUT_PLACEHOLDER: &str = "Type /help for commands";
const TIPS: [&str; 3] = [
    "Use /discover, /scan, /sweep or /inspect to get started.",
    "Be specific for best results. Try /scan <host> 22,80,443.",
    "Type /help for the full command list.",
];

pub struct TuiApp<'a> {
    pub history: Vec<HistoryEntry>,
    pub command_history: Vec<String>,
    pub input: TextArea<'a>,
    pub status: String,
    pub suggestions: Vec<CommandDef>,
    pub suggestion_index: usize,
    pub history_nav: Option<usize>,
    pub monitor: NetworkMonitor,
    pub confirm_exit: bool,
    pub running: bool,
    pub running_detail: Option<String>,
    pub spinner_idx: usize,
    pub settings: TuiSettings,
    pub hostname: String,
    pub context_address: Option<String>,
    pub tip_index: usize,
    pub tip_dismissed: bool,
    pub scroll_from_bottom: u16,
    stats_upload_mbps: f64,
    stats_download_mbps: f64,
    stats_upload_active: bool,
    stats_download_active: bool,
    input_scroll_x: usize,
    ui_mode: UiMode,
}

impl<'a> TuiApp<'a> {
    pub fn new() -> Self {
        let hostname = std::env::var("HOSTNAME")
            .or_else(|_| std::env::var("COMPUTERNAME"))
            .unwrap_or_else(|_| "n/a".to_string())
            .to_lowercase();

        let context_address = netscli_core::detect_default_ipv4_addr().map(|ip| ip.to_string());

        let tip_seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos() as usize;

        let mut input = TextArea::default();
        configure_input(&mut input);

        Self {
            history: Vec::new(),
            command_history: Vec::new(),
            input,
            status: "ready".to_string(),
            suggestions: Vec::new(),
            suggestion_index: 0,
            history_nav: None,
            monitor: NetworkMonitor::new(),
            confirm_exit: false,
            running: false,
            running_detail: None,
            spinner_idx: 0,
            settings: TuiSettings::default(),
            hostname,
            context_address,
            tip_index: tip_seed % TIPS.len(),
            tip_dismissed: false,
            scroll_from_bottom: 0,
            stats_upload_mbps: 0.0,
            stats_download_mbps: 0.0,
            stats_upload_active: false,
            stats_download_active: false,
            input_scroll_x: 0,
            ui_mode: UiMode::Normal,
        }
    }

    pub fn apply_settings(&mut self) {
        self.monitor
            .set_interface(self.settings.stats_interface.clone());
        self.context_address = crate::tui_settings::resolve_context_address(&self.settings);
    }

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

    pub fn reset_input(&mut self) {
        self.input = TextArea::default();
        configure_input(&mut self.input);
        self.input_scroll_x = 0;
    }

    pub fn set_input(&mut self, value: String) {
        self.input = TextArea::from([value]);
        configure_input(&mut self.input);
        self.input.move_cursor(CursorMove::End);
        self.input_scroll_x = 0;
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
                self.settings = TuiSettings::default();
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

    pub fn is_exact_command(&self, candidate: &str) -> bool {
        let candidate = candidate.trim().to_lowercase();
        COMMAND_DEFS.iter().any(|c| c.cmd == candidate)
    }

    pub fn selected_suggestion(&self) -> Option<CommandDef> {
        self.suggestions.get(self.suggestion_index).copied()
    }

    pub fn scroll_up(&mut self, lines: u16) {
        self.scroll_from_bottom = self.scroll_from_bottom.saturating_add(lines);
    }

    pub fn scroll_down(&mut self, lines: u16) {
        self.scroll_from_bottom = self.scroll_from_bottom.saturating_sub(lines);
    }

    pub fn scroll_to_bottom(&mut self) {
        self.scroll_from_bottom = 0;
    }

    fn config_state_mut(&mut self) -> Option<&mut ConfigUiState> {
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
