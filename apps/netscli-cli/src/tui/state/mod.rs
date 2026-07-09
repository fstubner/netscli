use super::command_catalog::{CommandDef, COMMAND_DEFS};
use super::config::UiMode;
use super::history::HistoryEntry;
use super::widgets::configure_input;
use crate::tui_settings::TuiSettings;
use netscli_core::NetworkMonitor;
use ratatui_textarea::{CursorMove, TextArea};
use std::time::{SystemTime, UNIX_EPOCH};

mod config_ui;
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
    pub concurrency_override: Option<usize>,
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
            concurrency_override: None,
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

    pub fn effective_concurrent_probes(&self) -> usize {
        self.concurrency_override
            .unwrap_or(self.settings.max_concurrent_probes)
    }

    pub fn apply_settings(&mut self) {
        self.monitor
            .set_interface(self.settings.stats_interface.clone());
        self.context_address = crate::tui_settings::resolve_context_address(&self.settings);
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
}
