use std::sync::OnceLock;
use std::time::Instant;

// ANSI SGR codes.
const RESET: &str = "\x1b[0m";
const CYAN: &str = "\x1b[36m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const RED: &str = "\x1b[31m";
const DIM: &str = "\x1b[2m";
const WHITE: &str = "\x1b[37m";

#[cfg(test)]
thread_local! {
    /// Lets one test turn colour on, or off, for itself. The real decision is
    /// made once per process, from the environment, so a test could not
    /// otherwise see how the tables look in a colour terminal.
    static FORCED: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// Run `f` with colour forced on or off, on this thread only.
#[cfg(test)]
pub(super) fn with_color<R>(on: bool, f: impl FnOnce() -> R) -> R {
    FORCED.with(|forced| forced.set(Some(on)));
    let result = f();
    FORCED.with(|forced| forced.set(None));
    result
}

/// Decide once per process whether we should emit ANSI color. See
/// [`decide_color`] for the rules.
fn color_enabled() -> bool {
    #[cfg(test)]
    {
        if let Some(forced) = FORCED.with(std::cell::Cell::get) {
            return forced;
        }
    }
    static DECISION: OnceLock<bool> = OnceLock::new();
    *DECISION.get_or_init(|| {
        // We only have access to `std::io::IsTerminal` without extra deps.
        use std::io::IsTerminal;
        decide_color(
            |name| std::env::var_os(name).map(|value| value.to_string_lossy().into_owned()),
            std::io::stdout().is_terminal(),
        )
    })
}

/// `NO_COLOR` wins over everything, as its convention asks. `CLICOLOR_FORCE`
/// keeps colour on when the output is piped, for `less -R` and CI logs. A
/// `TERM` of `dumb` has no use for colour codes. Otherwise colour goes to a
/// terminal and nowhere else.
fn decide_color(env: impl Fn(&str) -> Option<String>, stdout_is_terminal: bool) -> bool {
    if env("NO_COLOR").is_some() {
        return false;
    }
    if env("CLICOLOR_FORCE").is_some_and(|value| !value.is_empty() && value != "0") {
        return true;
    }
    if env("TERM").is_some_and(|term| term == "dumb") {
        return false;
    }
    stdout_is_terminal
}

/// Wrap `text` in `color` and a trailing RESET, or return the text untouched
/// when color is disabled. This is the single source of truth — using it
/// makes the "RESET before text" bug that plagued the original impossible.
pub(super) fn paint(color: &str, text: &str) -> String {
    if color_enabled() {
        format!("{color}{text}{RESET}")
    } else {
        text.to_string()
    }
}

pub(super) fn dim(text: &str) -> String {
    paint(DIM, text)
}
pub(super) fn cyan(text: &str) -> String {
    paint(CYAN, text)
}
pub(super) fn green(text: &str) -> String {
    paint(GREEN, text)
}
pub(super) fn yellow(text: &str) -> String {
    paint(YELLOW, text)
}
pub(super) fn red(text: &str) -> String {
    paint(RED, text)
}
pub(super) fn white(text: &str) -> String {
    paint(WHITE, text)
}

pub(super) fn duration_tag(start: Instant) -> Option<String> {
    let ms = start.elapsed().as_millis();
    if ms == 0 {
        None
    } else {
        Some(dim(&format!("[{ms} ms]")))
    }
}

pub(super) fn source_tag(addr: Option<&str>) -> Option<String> {
    addr.map(|a| dim(&format!("- source {a}")))
}

#[cfg(test)]
mod tests {
    use super::decide_color;
    use std::collections::HashMap;

    fn decide(vars: &[(&str, &str)], terminal: bool) -> bool {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect();
        decide_color(|name| vars.get(name).cloned(), terminal)
    }

    #[test]
    fn colour_follows_the_terminal_by_default() {
        assert!(decide(&[], true));
        assert!(!decide(&[], false));
    }

    #[test]
    fn no_color_beats_everything() {
        assert!(!decide(&[("NO_COLOR", "1")], true));
        assert!(!decide(&[("NO_COLOR", "1"), ("CLICOLOR_FORCE", "1")], true));
    }

    #[test]
    fn clicolor_force_keeps_colour_when_piped() {
        assert!(decide(&[("CLICOLOR_FORCE", "1")], false));
        assert!(!decide(&[("CLICOLOR_FORCE", "0")], false));
        assert!(!decide(&[("CLICOLOR_FORCE", "")], false));
    }

    #[test]
    fn a_dumb_terminal_gets_no_colour() {
        assert!(!decide(&[("TERM", "dumb")], true));
        assert!(decide(&[("TERM", "xterm-256color")], true));
    }
}
