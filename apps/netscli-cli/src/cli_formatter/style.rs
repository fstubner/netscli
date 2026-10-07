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

/// Decide once per process whether we should emit ANSI color. Respects the
/// `NO_COLOR` convention and falls back to "no color" when stdout is piped.
fn color_enabled() -> bool {
    #[cfg(test)]
    {
        if let Some(forced) = FORCED.with(std::cell::Cell::get) {
            return forced;
        }
    }
    static DECISION: OnceLock<bool> = OnceLock::new();
    *DECISION.get_or_init(|| {
        if std::env::var_os("NO_COLOR").is_some() {
            return false;
        }
        // We only have access to `std::io::IsTerminal` without extra deps.
        use std::io::IsTerminal;
        std::io::stdout().is_terminal()
    })
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
