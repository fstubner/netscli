use crate::formatter::Formatter;
use crate::tui_settings::{StatsUnit, TuiSettings};
use netscli_core::{NetworkManager, NetworkMonitor};
use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Padding, Paragraph, Wrap},
    Frame, Terminal,
};
use std::io;
use std::time::{SystemTime, UNIX_EPOCH};
use tui_textarea::{CursorMove, TextArea};

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

// Color palette. We detect the terminal's rough background via `COLORFGBG`
// (widely set by xterm/iTerm/GNOME Terminal) and pick a palette that stays
// readable in either direction. Dark-terminal palette preserves the
// original look; light-terminal palette uses darker foregrounds so labels
// don't wash out against white backgrounds.
//
// All call sites use the `palette()` function below, so callers don't
// need to know which palette they're on.

struct Palette {
    label: Color,
    value: Color,
    text: Color,
    tip: Color,
    exit: Color,
    args: Color,
    args_optional: Color,
    args_required: Color,
    args_flag: Color,
    desc: Color,
}

fn palette() -> &'static Palette {
    use std::sync::OnceLock;
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

#[derive(Clone, Copy, Debug)]
pub struct CommandDef {
    pub cmd: &'static str,
    pub desc: &'static str,
    pub args: &'static str,
}

#[cfg(feature = "pcap")]
const COMMAND_DEFS: &[CommandDef] = &[
    CommandDef {
        cmd: "/discover",
        desc: "Discover hosts on network",
        args: "[subnet]",
    },
    CommandDef {
        cmd: "/scan",
        desc: "Scan TCP ports on host",
        args: "<host> [ports]",
    },
    CommandDef {
        cmd: "/inspect",
        desc: "Inspect host (ping + scan + resolve)",
        args: "<host> [ports]",
    },
    CommandDef {
        cmd: "/sweep",
        desc: "Sweep network (discover + scan)",
        args: "[subnet] [ports] [--no-resolve]",
    },
    CommandDef {
        cmd: "/dns",
        desc: "DNS lookup",
        args: "<host> [--record <type>|ALL]",
    },
    CommandDef {
        cmd: "/reverse",
        desc: "Reverse DNS lookup",
        args: "<ip>",
    },
    CommandDef {
        cmd: "/ping",
        desc: "Ping host",
        args: "<host> [count]",
    },
    CommandDef {
        cmd: "/trace",
        desc: "Trace route (hops)",
        args: "<host> [--resolve] [--max-hops <n>]",
    },
    CommandDef {
        cmd: "/arp",
        desc: "Show ARP table",
        args: "",
    },
    CommandDef {
        cmd: "/interfaces",
        desc: "List network interfaces",
        args: "",
    },
    CommandDef {
        cmd: "/mdns",
        desc: "Discover devices via mDNS/Bonjour",
        args: "[--timeout <ms>]",
    },
    CommandDef {
        cmd: "/config",
        desc: "Configure TUI settings (interactive)",
        args: "",
    },
    CommandDef {
        cmd: "/export",
        desc: "Export session output",
        args: "[md|json] [--output <path>]",
    },
    CommandDef {
        cmd: "/pcap",
        desc: "Packet capture (requires privileges)",
        args: "[--check] <iface> [--filter <expr>] [--duration <secs>] [--output <file>] [--max-packets <n>]",
    },
    CommandDef {
        cmd: "/help",
        desc: "Show command help",
        args: "",
    },
    CommandDef {
        cmd: "/exit",
        desc: "Exit",
        args: "",
    },
];

#[cfg(not(feature = "pcap"))]
const COMMAND_DEFS: &[CommandDef] = &[
    CommandDef {
        cmd: "/discover",
        desc: "Discover hosts on network",
        args: "[subnet]",
    },
    CommandDef {
        cmd: "/scan",
        desc: "Scan TCP ports on host",
        args: "<host> [ports]",
    },
    CommandDef {
        cmd: "/inspect",
        desc: "Inspect host (ping + scan + resolve)",
        args: "<host> [ports]",
    },
    CommandDef {
        cmd: "/sweep",
        desc: "Sweep network (discover + scan)",
        args: "[subnet] [ports] [--no-resolve]",
    },
    CommandDef {
        cmd: "/dns",
        desc: "DNS lookup",
        args: "<host> [--record <type>|ALL]",
    },
    CommandDef {
        cmd: "/reverse",
        desc: "Reverse DNS lookup",
        args: "<ip>",
    },
    CommandDef {
        cmd: "/ping",
        desc: "Ping host",
        args: "<host> [count]",
    },
    CommandDef {
        cmd: "/trace",
        desc: "Trace route (hops)",
        args: "<host> [--resolve] [--max-hops <n>]",
    },
    CommandDef {
        cmd: "/arp",
        desc: "Show ARP table",
        args: "",
    },
    CommandDef {
        cmd: "/interfaces",
        desc: "List network interfaces",
        args: "",
    },
    CommandDef {
        cmd: "/mdns",
        desc: "Discover devices via mDNS/Bonjour",
        args: "[--timeout <ms>]",
    },
    CommandDef {
        cmd: "/config",
        desc: "Configure TUI settings (interactive)",
        args: "",
    },
    CommandDef {
        cmd: "/export",
        desc: "Export session output",
        args: "[md|json] [--output <path>]",
    },
    CommandDef {
        cmd: "/help",
        desc: "Show command help",
        args: "",
    },
    CommandDef {
        cmd: "/exit",
        desc: "Exit",
        args: "",
    },
];

pub fn help_lines() -> Vec<Line<'static>> {
    let mut lines: Vec<Line<'static>> = Vec::new();
    lines.push(Line::from(Span::styled(
        "Commands",
        Style::default()
            .fg(palette().text)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::default());
    for def in COMMAND_DEFS {
        lines.push(build_suggestion_line("  ", *def, false, usize::MAX));
    }
    lines
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryState {
    Running,
    Done,
}

#[derive(Clone, Debug)]
pub struct HistoryEntry {
    pub command: String,
    pub output: Vec<Line<'static>>,
    pub state: EntryState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConfigItemKind {
    StatsInterface,
    StatsUnit,
    DisplayInterface,
    DisplayIp,
    Reset,
    Done,
}

#[derive(Clone, Debug)]
struct ConfigUiState {
    selected: usize,
    scroll: u16,
    items: Vec<ConfigItemKind>,
    message: Option<String>,
}

impl ConfigUiState {
    fn new() -> Self {
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

    fn item(&self) -> Option<ConfigItemKind> {
        self.items.get(self.selected).copied()
    }

    fn len(&self) -> usize {
        self.items.len()
    }

    fn clamp_selected(&mut self) {
        if self.items.is_empty() {
            self.selected = 0;
        } else if self.selected >= self.items.len() {
            self.selected = self.items.len().saturating_sub(1);
        }
    }

    fn ensure_visible(&mut self, selected_line: u16, viewport: u16, total: u16) {
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

#[derive(Clone, Debug)]
enum UiMode {
    Normal,
    Config(ConfigUiState),
}

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

    pub fn draw<B: ratatui::backend::Backend>(
        &mut self,
        terminal: &mut Terminal<B>,
    ) -> io::Result<()> {
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

    pub fn push_command(&mut self, cmd: String) {
        self.tip_dismissed = true;
        self.confirm_exit = false;
        self.running_detail = None;
        self.scroll_to_bottom();
        self.history.push(HistoryEntry {
            command: cmd,
            output: Vec::new(),
            state: EntryState::Running,
        });
    }

    pub fn finish_current(&mut self, output: Vec<Line<'static>>) {
        if let Some(entry) = self.history.last_mut() {
            entry.output = output;
            entry.state = EntryState::Done;
        }
    }

    pub fn update_suggestions(&mut self) {
        let text = self.input.lines().join("\n");
        let trimmed = text.trim();
        if !trimmed.starts_with('/') {
            self.suggestions.clear();
            self.suggestion_index = 0;
            return;
        }

        let lower = trimmed.to_lowercase();
        let cmd_token = lower.split_whitespace().next().unwrap_or("");

        let mut matches: Vec<CommandDef> = COMMAND_DEFS
            .iter()
            .copied()
            .filter(|c| c.cmd.starts_with(cmd_token))
            .collect();

        if lower.contains(' ') {
            if let Some(def) = COMMAND_DEFS.iter().copied().find(|c| c.cmd == cmd_token) {
                matches = vec![def];
            }
        } else if matches.len() == 1 && matches[0].cmd == cmd_token {
            matches.clear();
        }

        self.suggestions = matches;
        if lower.contains(' ') || self.suggestion_index >= self.suggestions.len() {
            self.suggestion_index = 0;
        }
    }

    pub fn apply_tab_completion(&mut self) {
        let Some(choice) = self.selected_suggestion() else {
            return;
        };
        let raw = self.input.lines().join("\n");
        let trimmed = raw.trim();
        let rest = trimmed
            .char_indices()
            .find(|(_, ch)| ch.is_whitespace())
            .map(|(idx, _)| trimmed[idx..].trim())
            .unwrap_or("");

        let next = if rest.is_empty() {
            choice.cmd.to_string()
        } else {
            format!("{} {}", choice.cmd, rest)
        };
        self.set_input(next);
        self.suggestions.clear();
        self.suggestion_index = 0;
    }

    pub fn navigate_suggestions(&mut self, dir: i32) {
        if self.suggestions.is_empty() {
            return;
        }
        let len = self.suggestions.len();
        let next = if dir < 0 {
            if self.suggestion_index == 0 {
                len - 1
            } else {
                self.suggestion_index - 1
            }
        } else {
            (self.suggestion_index + 1) % len
        };
        self.suggestion_index = next;
    }

    /// Navigate through command history (bash-style).
    ///
    /// `dir < 0` (Up) walks toward older entries; `dir > 0` (Down) walks
    /// toward newer ones. `history_nav` tracks the current offset from
    /// the newest entry: `Some(0)` = newest, `Some(max-1)` = oldest,
    /// `None` = live input (below the newest).
    ///
    /// Pressing Down past the newest entry restores the live input,
    /// matching how shells behave.
    pub fn navigate_history(&mut self, dir: i32) {
        if self.command_history.is_empty() {
            return;
        }
        let max = self.command_history.len();

        let new_idx: Option<usize> = match (self.history_nav, dir.cmp(&0)) {
            // No-op on dir == 0
            (_, std::cmp::Ordering::Equal) => return,
            // At live input, pressing Up → most recent entry
            (None, std::cmp::Ordering::Less) => Some(0),
            // At live input, pressing Down → stay (nothing newer to show)
            (None, std::cmp::Ordering::Greater) => return,
            // In history, pressing Up → step to older (higher index)
            (Some(i), std::cmp::Ordering::Less) => Some((i + 1).min(max - 1)),
            // In history, pressing Down past newest (idx 0) → back to live input
            (Some(0), std::cmp::Ordering::Greater) => None,
            // In history, pressing Down → step to newer (lower index)
            (Some(i), std::cmp::Ordering::Greater) => Some(i - 1),
        };

        match new_idx {
            Some(idx) => {
                self.history_nav = Some(idx);
                self.set_input(self.command_history[max - 1 - idx].clone());
            }
            None => {
                self.history_nav = None;
                self.set_input(String::new());
            }
        }
    }

    pub fn reset_history_nav(&mut self) {
        self.history_nav = None;
    }

    pub fn set_status(&mut self, msg: impl Into<String>) {
        self.status = msg.into();
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

    fn render_scrollbar(&self, f: &mut Frame<'_>, area: Rect, total: u16, viewport: u16, top: u16) {
        if area.width == 0 || area.height == 0 || viewport == 0 {
            return;
        }
        if total <= viewport {
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

    fn message_height(&self) -> u16 {
        if self.confirm_exit {
            3
        } else {
            0
        }
    }

    fn should_show_tip(&self) -> bool {
        self.history.is_empty() && !self.running && !self.tip_dismissed
    }

    fn render_message(&mut self, f: &mut Frame<'_>, area: Rect) {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(label_style())
            .padding(Padding::horizontal(1));
        let inner = block.inner(area);
        f.render_widget(block, area);

        if !self.confirm_exit {
            return;
        }

        let line = Line::from(vec![
            Span::styled("Exit", Style::default().fg(palette().exit)),
            Span::styled(" · ", label_style()),
            Span::styled(
                "Press Esc or Ctrl+C again to exit.".to_string(),
                value_style(),
            ),
        ]);
        f.render_widget(Paragraph::new(line).wrap(Wrap { trim: false }), inner);
    }

    fn build_config_lines(
        &self,
        content_width: u16,
        state: &ConfigUiState,
    ) -> (Vec<Line<'static>>, Vec<usize>) {
        let mut lines: Vec<Line<'static>> = Vec::new();
        let mut item_lines: Vec<usize> = Vec::new();

        lines.extend(self.header_lines(content_width as usize, u16::MAX));
        lines.push(Line::default());
        lines.push(Line::from(vec![Span::styled(
            "Config",
            Style::default().fg(Color::Cyan),
        )]));
        lines.push(Line::from(vec![Span::styled(
            "Use \u{2191}/\u{2193} to move, \u{2190}/\u{2192} to change, Enter to apply, Esc to exit.",
            Style::default().fg(Color::DarkGray),
        )]));
        lines.push(Line::default());

        let resolved = self
            .context_address
            .clone()
            .unwrap_or_else(|| "n/a".to_string());

        for (idx, item) in state.items.iter().enumerate() {
            if *item == ConfigItemKind::Reset {
                lines.push(Line::default());
            }

            let selected = idx == state.selected;
            let (label, value) = match item {
                ConfigItemKind::StatsInterface => (
                    "stats interface",
                    self.settings
                        .stats_interface
                        .clone()
                        .unwrap_or_else(|| "auto".to_string()),
                ),
                ConfigItemKind::StatsUnit => {
                    ("stats unit", self.settings.stats_unit.suffix().into())
                }
                ConfigItemKind::DisplayInterface => (
                    "display interface",
                    self.settings
                        .display_interface
                        .clone()
                        .unwrap_or_else(|| "auto".to_string()),
                ),
                ConfigItemKind::DisplayIp => (
                    "display ip",
                    if let Some(ip) = self.settings.display_ip.clone() {
                        ip
                    } else {
                        format!("auto (resolved: {resolved})")
                    },
                ),
                ConfigItemKind::Reset => ("Reset to defaults", String::new()),
                ConfigItemKind::Done => ("Done", String::new()),
            };

            item_lines.push(lines.len());
            lines.push(config_line(label, &value, selected));
        }

        if let Some(msg) = state.message.as_deref() {
            lines.push(Line::default());
            lines.push(Line::from(vec![
                Span::styled("Error: ", Style::default().fg(Color::Red)),
                Span::styled(msg.to_string(), Style::default().fg(Color::Gray)),
            ]));
        }

        (lines, item_lines)
    }

    fn build_scroll_lines(&mut self, content_width: u16) -> Vec<Line<'static>> {
        let mut lines: Vec<Line<'static>> = Vec::new();
        lines.extend(self.header_lines(content_width as usize, u16::MAX));
        if self.should_show_tip() {
            let tip_text = TIPS.get(self.tip_index).copied().unwrap_or(TIPS[0]);
            let tip_line = Line::from(vec![
                Span::styled("Tip", Style::default().fg(palette().tip)),
                Span::styled(" · ", label_style()),
                Span::styled(tip_text.to_string(), value_style()),
            ]);
            lines.extend(boxed_lines(vec![tip_line], content_width, label_style()));
        }

        let spinner = self.spinner_frame();
        for (i, entry) in self.history.iter().enumerate() {
            let mut inner = Vec::new();
            inner.push(Formatter::format_command_prompt(&entry.command));
            if entry.state == EntryState::Running {
                let msg = running_message(&entry.command);
                inner.push(Line::from(vec![
                    Span::styled(spinner, Style::default().fg(Color::Cyan)),
                    Span::raw(" "),
                    Span::styled(msg, Style::default().fg(palette().text)),
                ]));
                if let Some(detail) = &self.running_detail {
                    inner.push(Line::from(vec![
                        Span::raw("  "),
                        Span::styled(detail.to_string(), value_style()),
                    ]));
                }
            }
            if !entry.output.is_empty() {
                inner.push(Line::default());
                inner.extend(entry.output.clone());
            }

            lines.extend(boxed_lines(inner, content_width, label_style()));
            if i + 1 < self.history.len() {
                lines.push(Line::default());
            }
        }

        lines
    }

    fn header_lines(&self, content_width: usize, max_height: u16) -> Vec<Line<'static>> {
        if max_height == 0 {
            return Vec::new();
        }

        let top_pad = if max_height < 18 { 2 } else { 3 };
        let mut lines: Vec<Line<'static>> = Vec::new();
        for _ in 0..top_pad {
            lines.push(Line::default());
        }

        let (banner, _rightmost) = self.banner_lines_centered(content_width);
        lines.extend(banner);

        // Single subtitle line: tagline + version together, centered. This
        // keeps the banner compact and avoids the old "floating v0.1.0"
        // that landed awkwardly to the right of the banner.
        let ver = format!("v{}", env!("CARGO_PKG_VERSION"));
        let sep = "  ·  ";
        let subtitle_plain = format!("{TAGLINE}{sep}{ver}");
        let subtitle_len = subtitle_plain.chars().count().min(content_width);
        let indent = content_width.saturating_sub(subtitle_len) / 2;
        lines.push(Line::from(vec![
            Span::raw(" ".repeat(indent)),
            Span::styled(TAGLINE, Style::default().fg(palette().text)),
            Span::styled(sep, label_style()),
            Span::styled(ver, label_style()),
        ]));

        lines.push(Line::default());

        while (lines.len() as u16) > max_height {
            lines.pop();
        }
        lines
    }

    fn banner_lines_centered(&self, width: usize) -> (Vec<Line<'static>>, usize) {
        let max_len = ANSI_SHADOW_BANNER
            .iter()
            .map(|l| l.chars().count())
            .max()
            .unwrap_or(1);
        let effective = max_len.max(1).min(width.max(1));

        let mut rightmost = 0usize;
        let lines: Vec<Line<'static>> = ANSI_SHADOW_BANNER
            .iter()
            .map(|line| {
                let len = line.chars().count().min(effective);
                let pad = width.saturating_sub(len) / 2;
                rightmost = rightmost.max(pad + len);
                gradient_text_line_with_left_pad(line, len.max(1), pad)
            })
            .collect();
        (lines, rightmost)
    }

    fn render_input(&mut self, f: &mut Frame<'_>, area: Rect) {
        if area.width == 0 || area.height == 0 {
            return;
        }

        // If the terminal is too short for the full input layout, fall back to a compact
        // single-line input + optional stats row (avoids a "collapsed" box).
        if area.height < input_container_height(0) {
            let block = Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(label_style())
                .padding(Padding::horizontal(1));
            let inner = block.inner(area);
            f.render_widget(block, area);

            if inner.width == 0 || inner.height == 0 {
                return;
            }

            if inner.height == 1 {
                self.render_text_box(f, inner);
                return;
            }

            let input_row = Rect {
                x: inner.x,
                y: inner.y,
                width: inner.width,
                height: 1,
            };
            let stats_row = Rect {
                x: inner.x,
                y: inner.y.saturating_add(inner.height.saturating_sub(1)),
                width: inner.width,
                height: 1,
            };
            self.render_text_box(f, input_row);

            let (_left, right) = self.render_stats_lines();
            f.render_widget(Paragraph::new(right).alignment(Alignment::Right), stats_row);
            return;
        }

        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(label_style())
            .padding(Padding::horizontal(1));
        let inner = block.inner(area);
        f.render_widget(block, area);

        let text_box_h = 3u16;
        let stats_h = 1u16;

        // When the terminal is "medium short" (e.g. enough for the input container but not enough
        // for a full 6-item autocomplete list), shrink the suggestions list instead of letting
        // ratatui squeeze the textbox into a broken-looking single row.
        let min_inner_h = text_box_h.saturating_add(stats_h);
        let mut max_sugg_items_h = 0u16;
        if !self.suggestions.is_empty() && inner.height > min_inner_h {
            let remaining = inner.height.saturating_sub(min_inner_h);
            // Suggestions box needs its own borders (2) plus at least 1 item row (1) => 3.
            if remaining >= 3 {
                max_sugg_items_h = remaining.saturating_sub(2);
            }
        }

        let sugg_items_h = (self.suggestions.len().min(6) as u16).min(max_sugg_items_h);
        let sugg_box_h = if sugg_items_h > 0 {
            sugg_items_h + 2
        } else {
            0
        };

        let mut constraints = vec![Constraint::Length(text_box_h)];
        if sugg_box_h > 0 {
            constraints.push(Constraint::Length(sugg_box_h));
        }
        constraints.push(Constraint::Length(stats_h));

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints(constraints)
            .split(inner);

        self.render_text_box(f, chunks[0]);

        let mut idx = 1;
        if sugg_box_h > 0 {
            let sugg_area = chunks[idx];
            let sugg_block = Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(label_style())
                .padding(Padding::horizontal(1));
            let sugg_inner = sugg_block.inner(sugg_area);
            f.render_widget(sugg_block, sugg_area);

            let max_visible = sugg_items_h.max(1) as usize;
            let total = self.suggestions.len();
            let visible_len = total.min(max_visible);
            let start = suggestion_window_start(total, max_visible, self.suggestion_index);

            let show_scrollbar = total > max_visible && sugg_inner.width > 1;
            let bar_width = if show_scrollbar { 1 } else { 0 };
            let text_width = sugg_inner.width.saturating_sub(bar_width).max(1) as usize;

            let mut sugg_lines: Vec<Line<'static>> = Vec::new();
            let (thumb_top, thumb_height) =
                scrollbar_thumb(start as u16, total as u16, visible_len as u16);
            for i in 0..visible_len {
                let idx_abs = start + i;
                let s = self.suggestions[idx_abs];
                let selected = idx_abs == self.suggestion_index;
                let prefix = if selected { "> " } else { "  " };
                let mut line = build_suggestion_line(prefix, s, selected, text_width);
                line = pad_line_to_width(line, text_width, label_style());
                if show_scrollbar {
                    let row = i as u16;
                    let bar = if row >= thumb_top && row < thumb_top + thumb_height {
                        Span::styled("█", value_style())
                    } else {
                        Span::styled("│", label_style())
                    };
                    line.spans.push(bar);
                }
                sugg_lines.push(line);
            }
            f.render_widget(
                Paragraph::new(sugg_lines).wrap(Wrap { trim: false }),
                sugg_inner,
            );
            idx += 1;
        }

        let (left, right) = self.render_stats_lines();
        let parts = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(chunks[idx]);
        f.render_widget(Paragraph::new(left).alignment(Alignment::Left), parts[0]);
        f.render_widget(Paragraph::new(right).alignment(Alignment::Right), parts[1]);
    }

    fn render_text_box(&mut self, f: &mut Frame<'_>, area: Rect) {
        let w = area.width as usize;
        let blink_on = cursor_blink_on();
        if area.height < 3 || w < 8 {
            let (row, col) = self.input.cursor();
            let cursor_col = if row == 0 { col } else { 0 };
            let raw = self.input.lines().first().cloned().unwrap_or_default();
            let empty = raw.trim().is_empty();
            let display = if empty {
                INPUT_PLACEHOLDER.to_string()
            } else {
                raw.clone()
            };
            let width = area.width.max(1) as usize;
            let style = if empty {
                placeholder_style()
            } else {
                Style::default().fg(palette().text)
            };

            let prompt = "> ";
            let avail = width.saturating_sub(prompt.chars().count()).max(1);
            self.input_scroll_x = next_scroll_top(self.input_scroll_x, cursor_col, avail);
            if empty {
                self.input_scroll_x = 0;
            }
            let visible = slice_chars(&display, self.input_scroll_x, avail);
            let cursor_x = cursor_col
                .saturating_sub(self.input_scroll_x)
                .min(avail.saturating_sub(1));

            let mut spans = vec![Span::styled(prompt, placeholder_style())];
            spans.extend(line_with_drawn_cursor(&visible, style, cursor_x, avail, blink_on).spans);
            f.render_widget(
                Paragraph::new(Line::from(spans)).wrap(Wrap { trim: false }),
                area,
            );
            return;
        }

        let (row, col) = self.input.cursor();
        let cursor_col = if row == 0 { col } else { 0 };

        let raw = self.input.lines().first().cloned().unwrap_or_default();
        let empty = raw.trim().is_empty();
        let display = if empty {
            INPUT_PLACEHOLDER.to_string()
        } else {
            raw.clone()
        };

        draw_gradient_rounded_border(f, area);
        let inner = Rect {
            x: area.x.saturating_add(2),
            y: area.y.saturating_add(1),
            width: area.width.saturating_sub(4),
            height: area.height.saturating_sub(2),
        };

        let width = inner.width.max(1) as usize;
        let prompt = "> ";
        let avail = width.saturating_sub(prompt.chars().count()).max(1);
        self.input_scroll_x = next_scroll_top(self.input_scroll_x, cursor_col, avail);
        if empty {
            self.input_scroll_x = 0;
        }

        let visible = slice_chars(&display, self.input_scroll_x, avail);
        let style = if empty {
            placeholder_style()
        } else {
            Style::default().fg(palette().text)
        };
        let cursor_x = cursor_col
            .saturating_sub(self.input_scroll_x)
            .min(avail.saturating_sub(1));

        let mut spans = vec![Span::styled(prompt, placeholder_style())];
        spans.extend(line_with_drawn_cursor(&visible, style, cursor_x, avail, blink_on).spans);
        f.render_widget(
            Paragraph::new(Line::from(spans)).wrap(Wrap { trim: false }),
            inner,
        );
    }

    fn render_stats_lines(&mut self) -> (Line<'static>, Line<'static>) {
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

    fn spinner_frame(&mut self) -> &'static str {
        if !self.running {
            return " ";
        }
        let frames = ["-", "\\", "|", "/"];
        let ch = frames[self.spinner_idx % frames.len()];
        self.spinner_idx = (self.spinner_idx + 1) % frames.len();
        ch
    }
}

fn configure_input(input: &mut TextArea<'_>) {
    input.set_cursor_line_style(Style::default());
    input.set_cursor_style(Style::default());
    input.set_style(Style::default().fg(palette().text));
    input.set_placeholder_text(INPUT_PLACEHOLDER);
    input.set_placeholder_style(label_style());
    input.set_block(Block::default().borders(Borders::NONE));
}

fn label_style() -> Style {
    Style::default().fg(palette().label)
}

fn value_style() -> Style {
    Style::default().fg(palette().value)
}

fn placeholder_style() -> Style {
    // Use a mid-gray so the placeholder stays readable without overpowering the UI.
    Style::default().fg(palette().args)
}

fn cursor_blink_on() -> bool {
    const BLINK_MS: u128 = 520;
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    (ms / BLINK_MS).is_multiple_of(2)
}

fn line_with_drawn_cursor(
    text: &str,
    style: Style,
    cursor_x: usize,
    width: usize,
    blink_on: bool,
) -> Line<'static> {
    let width = width.max(1);
    let cursor_x = cursor_x.min(width.saturating_sub(1));
    let mut chars: Vec<char> = text.chars().collect();
    while chars.len() < width {
        chars.push(' ');
    }
    let left: String = chars.iter().take(cursor_x).collect();
    let cursor_cell = chars.get(cursor_x).copied().unwrap_or(' ');
    let right: String = chars
        .iter()
        .skip(cursor_x.saturating_add(1))
        .take(width.saturating_sub(cursor_x.saturating_add(1)))
        .collect();

    let mut spans: Vec<Span<'static>> = Vec::new();
    if !left.is_empty() {
        spans.push(Span::styled(left, style));
    }
    let cursor_style = if blink_on {
        Style::default()
            .fg(palette().text)
            .add_modifier(Modifier::REVERSED)
    } else {
        style
    };
    spans.push(Span::styled(cursor_cell.to_string(), cursor_style));
    if !right.is_empty() {
        spans.push(Span::styled(right, style));
    }
    Line::from(spans)
}

fn running_message(command: &str) -> String {
    let mut parts = command.split_whitespace();
    let cmd = parts.next().unwrap_or("").to_lowercase();
    match cmd.as_str() {
        "/discover" => match parts.next() {
            Some(subnet) => format!("Discovering {subnet}..."),
            None => "Discovering hosts...".to_string(),
        },
        "/scan" => match parts.next() {
            Some(host) => format!("Scanning {host}..."),
            None => "Scanning...".to_string(),
        },
        "/inspect" => match parts.next() {
            Some(host) => format!("Inspecting {host}..."),
            None => "Inspecting...".to_string(),
        },
        "/sweep" => match parts.next() {
            Some(subnet) => format!("Sweeping {subnet}..."),
            None => "Sweeping network...".to_string(),
        },
        "/dns" => match parts.next() {
            Some(host) => format!("Resolving {host}..."),
            None => "Resolving...".to_string(),
        },
        "/ping" => match parts.next() {
            Some(host) => format!("Pinging {host}..."),
            None => "Pinging...".to_string(),
        },
        "/trace" => match parts.next() {
            Some(host) => format!("Tracing {host}..."),
            None => "Tracing route...".to_string(),
        },
        "/arp" => "Reading ARP table...".to_string(),
        "/interfaces" => "Reading interfaces...".to_string(),
        "/mdns" => "Browsing mDNS...".to_string(),
        "/pcap" => "Capturing packets...".to_string(),
        _ => "Working...".to_string(),
    }
}

fn build_suggestion_line(
    prefix: &str,
    def: CommandDef,
    selected: bool,
    max_width: usize,
) -> Line<'static> {
    let mut spans: Vec<(String, Style)> = Vec::new();
    spans.push((prefix.to_string(), label_style()));

    let cmd_style = if selected {
        Style::default()
            .fg(palette().text)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(palette().text)
    };
    spans.push((def.cmd.to_string(), cmd_style));
    spans.push((" ".to_string(), Style::default()));

    if !def.args.is_empty() {
        for (i, tok) in def.args.split_whitespace().enumerate() {
            if i > 0 {
                spans.push((" ".to_string(), Style::default()));
            }
            let style = if tok.starts_with("--") {
                Style::default().fg(palette().args_flag)
            } else if tok.starts_with('[') && tok.ends_with(']') {
                Style::default().fg(palette().args_optional)
            } else if tok.starts_with('<') && tok.ends_with('>') {
                Style::default().fg(palette().args_required)
            } else {
                Style::default().fg(palette().args)
            };
            spans.push((tok.to_string(), style));
        }
        spans.push((" ".to_string(), Style::default()));
    }

    spans.push(("- ".to_string(), label_style()));
    spans.push((def.desc.to_string(), Style::default().fg(palette().desc)));

    let spans = truncate_styled_spans(spans, max_width);
    Line::from(
        spans
            .into_iter()
            .map(|(s, st)| Span::styled(s, st))
            .collect::<Vec<_>>(),
    )
}

fn truncate_styled_spans(
    mut spans: Vec<(String, Style)>,
    max_width: usize,
) -> Vec<(String, Style)> {
    if max_width == 0 {
        return Vec::new();
    }
    let current: usize = spans.iter().map(|(s, _)| s.chars().count()).sum();
    if current <= max_width {
        return spans;
    }
    if max_width <= 1 {
        return vec![("…".to_string(), label_style())];
    }

    let target = max_width - 1;
    let mut out: Vec<(String, Style)> = Vec::new();
    let mut used = 0usize;

    for (s, st) in spans.drain(..) {
        if used >= target {
            break;
        }
        let remaining = target - used;
        let take = s.chars().take(remaining).collect::<String>();
        let take_len = take.chars().count();
        if take_len > 0 {
            out.push((take, st));
            used += take_len;
        }
    }

    out.push(("…".to_string(), label_style()));
    out
}

fn boxed_lines(inner: Vec<Line<'static>>, width: u16, border_style: Style) -> Vec<Line<'static>> {
    let w = width as usize;
    if w < 4 {
        return inner;
    }
    let pad = 1usize;
    let inner_w = w.saturating_sub(2 + pad * 2);

    let mut out: Vec<Line<'static>> = Vec::new();
    out.push(solid_border_line(
        '╭',
        '─',
        '╮',
        w.saturating_sub(2),
        border_style,
    ));

    let content_lines = if inner.is_empty() {
        vec![Line::default()]
    } else {
        inner
    };
    for line in content_lines {
        let clipped = truncate_line_to_width(line, inner_w, border_style);
        let current_w = line_width(&clipped);
        let pad_right = inner_w.saturating_sub(current_w);
        let mut spans: Vec<Span<'static>> = Vec::new();
        spans.push(Span::styled("│", border_style));
        spans.push(Span::raw(" ".repeat(pad)));
        spans.extend(clipped.spans);
        spans.push(Span::raw(" ".repeat(pad_right + pad)));
        spans.push(Span::styled("│", border_style));
        out.push(Line::from(spans));
    }

    out.push(solid_border_line(
        '╰',
        '─',
        '╯',
        w.saturating_sub(2),
        border_style,
    ));
    out
}

/// Terminal display width of a ratatui `Line`.
///
/// Uses `unicode-width` so East Asian wide chars (CJK) and emoji take 2
/// cells instead of being miscounted as 1. Previously this used
/// `chars().count()` which over-counted narrow multi-byte sequences and
/// under-counted wide glyphs, causing column-aligned tables to drift.
fn line_width(line: &Line<'static>) -> usize {
    use unicode_width::UnicodeWidthStr;
    line.to_string().width()
}

fn truncate_line_to_width(
    mut line: Line<'static>,
    max_width: usize,
    style: Style,
) -> Line<'static> {
    let width = line_width(&line);
    if width <= max_width {
        return line;
    }
    if max_width == 0 {
        return Line::default();
    }

    let target = max_width.saturating_sub(1);
    let mut out: Vec<Span<'static>> = Vec::new();
    let mut used = 0usize;

    for span in line.spans.drain(..) {
        if used >= target {
            break;
        }
        let s = span.content.to_string();
        let remaining = target - used;
        let take = s.chars().take(remaining).collect::<String>();
        used += take.chars().count();
        if !take.is_empty() {
            out.push(Span::styled(take, span.style));
        }
    }

    out.push(Span::styled("…", style));
    Line::from(out)
}

fn solid_border_line(
    left: char,
    horiz: char,
    right: char,
    inner: usize,
    style: Style,
) -> Line<'static> {
    Line::from(vec![
        Span::styled(left.to_string(), style),
        Span::styled(horiz.to_string().repeat(inner), style),
        Span::styled(right.to_string(), style),
    ])
}

fn gradient_text_line_with_left_pad(text: &str, width: usize, left_pad: usize) -> Line<'static> {
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

fn input_container_height(suggestions_len: usize) -> u16 {
    let sugg_items = suggestions_len.min(6) as u16;
    if sugg_items == 0 {
        // inner: textbox (3) + stats (1) => 4; outer: +2 borders => 6
        6
    } else {
        // inner: textbox (3) + suggestions box (items + 2) + stats (1) => items + 6
        // outer: +2 borders => items + 8
        sugg_items + 8
    }
}

fn suggestion_window_start(total: usize, window: usize, selected: usize) -> usize {
    if total <= window {
        return 0;
    }

    let half = window / 2;
    let mut start = selected.saturating_sub(half);
    let max_start = total.saturating_sub(window);
    if start > max_start {
        start = max_start;
    }
    start
}

fn pad_line_to_width(mut line: Line<'static>, width: usize, style: Style) -> Line<'static> {
    let current = line_width(&line);
    if current >= width {
        return line;
    }
    let pad = " ".repeat(width - current);
    line.spans.push(Span::styled(pad, style));
    line
}

fn scrollbar_thumb(top: u16, total: u16, viewport: u16) -> (u16, u16) {
    if viewport == 0 || total <= viewport {
        return (0, viewport);
    }

    let viewport_u32 = viewport as u32;
    let total_u32 = total as u32;
    let thumb = ((viewport_u32 * viewport_u32) / total_u32).max(1) as u16;
    let thumb = thumb.min(viewport);

    let max_scroll = total.saturating_sub(viewport);
    let max_thumb_top = viewport.saturating_sub(thumb);
    let thumb_top = if max_scroll == 0 || max_thumb_top == 0 {
        0
    } else {
        ((top as u32 * max_thumb_top as u32) / max_scroll as u32) as u16
    };

    (thumb_top, thumb)
}

fn next_scroll_top(prev_top: usize, cursor: usize, length: usize) -> usize {
    if length == 0 {
        return 0;
    }
    if cursor < prev_top {
        cursor
    } else if prev_top + length <= cursor {
        cursor + 1 - length
    } else {
        prev_top
    }
}

fn slice_chars(text: &str, start: usize, len: usize) -> String {
    if len == 0 {
        return String::new();
    }
    text.chars().skip(start).take(len).collect()
}

fn cycle_option(current: Option<&str>, options: &[String], dir: i32) -> Option<String> {
    let mut all = Vec::with_capacity(options.len() + 1);
    all.push("auto".to_string());
    all.extend(options.iter().cloned());

    if all.is_empty() {
        return None;
    }

    let current = current.unwrap_or("auto");
    let idx = all
        .iter()
        .position(|v| v.eq_ignore_ascii_case(current))
        .unwrap_or(0);
    let next = if dir < 0 {
        if idx == 0 {
            all.len() - 1
        } else {
            idx - 1
        }
    } else {
        (idx + 1) % all.len()
    };

    let value = &all[next];
    if value.eq_ignore_ascii_case("auto") {
        None
    } else {
        Some(value.clone())
    }
}

fn cycle_unit(current: StatsUnit, dir: i32) -> StatsUnit {
    let units = [StatsUnit::Kbps, StatsUnit::Mbps, StatsUnit::Gbps];
    let idx = units.iter().position(|u| *u == current).unwrap_or(0);
    let next = if dir < 0 {
        if idx == 0 {
            units.len() - 1
        } else {
            idx - 1
        }
    } else {
        (idx + 1) % units.len()
    };
    units[next]
}

fn config_line(label: &str, value: &str, selected: bool) -> Line<'static> {
    let bg = if selected {
        Some(Color::Rgb(52, 56, 64))
    } else {
        None
    };
    let mut label_style = Style::default().fg(Color::DarkGray);
    let mut value_style = Style::default().fg(Color::Gray);
    let mut prefix_style = Style::default().fg(Color::DarkGray);
    let mut action_style = Style::default().fg(Color::White);

    if let Some(bg) = bg {
        label_style = label_style.bg(bg);
        value_style = value_style.bg(bg);
        prefix_style = prefix_style.bg(bg);
        action_style = action_style.bg(bg);
    }

    if value.is_empty() {
        return Line::from(vec![
            Span::styled("  ", prefix_style),
            Span::styled(label.to_string(), action_style),
        ]);
    }

    Line::from(vec![
        Span::styled("  ", prefix_style),
        Span::styled(format!("{label}: "), label_style),
        Span::styled(value.to_string(), value_style),
    ])
}

fn draw_gradient_rounded_border(f: &mut Frame<'_>, area: Rect) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;

    fn render_to_lines(app: &mut TuiApp<'_>, width: u16, height: u16) -> Vec<String> {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).expect("terminal");
        app.draw(&mut terminal).expect("draw");

        let buffer = terminal.backend().buffer();
        let mut lines = Vec::new();
        for y in 0..height {
            let mut row = String::new();
            for x in 0..width {
                row.push_str(buffer[(x, y)].symbol());
            }
            lines.push(row);
        }
        lines
    }

    #[test]
    fn input_prompt_renders_with_suggestions_in_medium_terminal() {
        let mut app = TuiApp::new();
        app.tip_dismissed = true;
        app.suggestions = COMMAND_DEFS.iter().copied().take(6).collect();
        app.suggestion_index = 0;

        let lines = render_to_lines(&mut app, 80, 12);
        assert!(
            lines.iter().any(|l| l.contains("> ")),
            "expected input prompt to be visible"
        );
        assert!(
            lines[11].contains('╰') && lines[11].contains('╯'),
            "expected input container border at bottom row"
        );
    }

    #[test]
    fn input_prompt_renders_in_short_terminal() {
        let mut app = TuiApp::new();
        app.tip_dismissed = true;
        app.suggestions = COMMAND_DEFS.iter().copied().take(6).collect();

        let lines = render_to_lines(&mut app, 80, 5);
        assert!(
            lines.iter().any(|l| l.contains("> ")),
            "expected input prompt to be visible"
        );
    }

    // ----------------------------------------------------------------
    // Input / state-machine tests exercising the behavior that the
    // pty-driven smoke test confirms at the rendering level.
    // ----------------------------------------------------------------

    /// Convenience: type `input` as text into the app's textarea so we
    /// can inspect suggestion and autocomplete behavior without a pty.
    fn type_text(app: &mut TuiApp<'_>, input: &str) {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        for ch in input.chars() {
            app.input
                .input(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }
    }

    #[test]
    fn suggestions_match_prefix() {
        let mut app = TuiApp::new();
        type_text(&mut app, "/dis");
        app.update_suggestions();
        assert!(
            app.suggestions.iter().any(|c| c.cmd == "/discover"),
            "expected /discover to match /dis prefix; got {:?}",
            app.suggestions.iter().map(|c| c.cmd).collect::<Vec<_>>()
        );
    }

    #[test]
    fn tab_completion_advances_to_unique_match() {
        let mut app = TuiApp::new();
        type_text(&mut app, "/dis");
        app.update_suggestions();
        app.apply_tab_completion();
        let completed = app.input.lines().join("\n");
        assert!(
            completed.starts_with("/discover"),
            "expected /dis<Tab> to expand to /discover, got '{completed}'"
        );
    }

    #[test]
    fn is_exact_command_matches_lowercase() {
        let app = TuiApp::new();
        assert!(app.is_exact_command("/discover"));
        assert!(app.is_exact_command("/DISCOVER")); // case-insensitive
        assert!(!app.is_exact_command("/dis"));
    }

    #[test]
    fn history_navigation_round_trips() {
        let mut app = TuiApp::new();
        app.command_history.push("/discover".to_string());
        app.command_history.push("/scan 127.0.0.1".to_string());
        app.command_history.push("/ping 1.1.1.1".to_string());

        // Up → newest
        app.navigate_history(-1);
        assert_eq!(app.input.lines().join("\n"), "/ping 1.1.1.1");
        // Up again → older
        app.navigate_history(-1);
        assert_eq!(app.input.lines().join("\n"), "/scan 127.0.0.1");
        // Up again → oldest
        app.navigate_history(-1);
        assert_eq!(app.input.lines().join("\n"), "/discover");
        // Up at oldest → stays at oldest (no further back)
        app.navigate_history(-1);
        assert_eq!(app.input.lines().join("\n"), "/discover");
        // Down → newer
        app.navigate_history(1);
        assert_eq!(app.input.lines().join("\n"), "/scan 127.0.0.1");
        // Down → newest
        app.navigate_history(1);
        assert_eq!(app.input.lines().join("\n"), "/ping 1.1.1.1");
        // Down past newest → live input restored
        app.navigate_history(1);
        assert_eq!(
            app.input.lines().join("\n"),
            "",
            "Down past newest entry should restore the live input"
        );
    }

    #[test]
    fn history_navigation_no_op_on_empty() {
        let mut app = TuiApp::new();
        app.navigate_history(-1);
        app.navigate_history(1);
        assert_eq!(app.input.lines().join("\n"), "");
    }

    #[test]
    fn suggestion_navigation_wraps() {
        let mut app = TuiApp::new();
        app.suggestions = COMMAND_DEFS.iter().copied().take(3).collect();
        app.suggestion_index = 0;

        // Down advances
        app.navigate_suggestions(1);
        assert_eq!(app.suggestion_index, 1);
        // Wrap-around past the end
        app.navigate_suggestions(1);
        app.navigate_suggestions(1);
        assert_eq!(
            app.suggestion_index, 0,
            "expected suggestion nav to wrap from last back to first"
        );
    }

    #[test]
    fn config_modal_enters_and_exits() {
        let mut app = TuiApp::new();
        assert!(!app.is_config_mode());
        app.enter_config();
        assert!(
            app.is_config_mode(),
            "enter_config() should switch into config modal"
        );
        app.exit_config();
        assert!(
            !app.is_config_mode(),
            "exit_config() should leave config modal"
        );
    }

    #[test]
    fn empty_suggestions_does_not_panic_on_tab() {
        let mut app = TuiApp::new();
        // No input, no suggestions → Tab should be a no-op, not a panic.
        app.apply_tab_completion();
        app.suggestions.clear();
        app.apply_tab_completion();
    }

    #[test]
    fn status_setter_updates_message() {
        let mut app = TuiApp::new();
        app.set_status("Running...");
        assert!(
            app.status.contains("Running"),
            "expected status to contain 'Running', got '{}'",
            app.status
        );
    }
}
