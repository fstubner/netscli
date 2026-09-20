//! Recovery from a WebKitGTK compositor that fails without saying so.
//!
//! On some Linux hosts the window opens and never paints anything. WebKitGTK's
//! hardware compositing path fails against a driver that only partly supports
//! it, and it fails silently -- nothing on stderr, no crash, no clue. Seen on a
//! VM using `vmwgfx` in #378. `WEBKIT_DISABLE_COMPOSITING_MODE=1` fixes it, at
//! the cost of hardware compositing, which is why it is not simply set for
//! everyone.
//!
//! Two ways out, because the obvious third one does not work. A toggle in the
//! app's settings dialog would be useless here: every GUI preference lives in
//! `localStorage`, inside the webview, and the webview is the thing that is not
//! rendering. Someone looking at a blank window cannot reach it.
//!
//! So: a command-line flag, which they can still use, and a marker file that
//! notices when a launch never got as far as painting and turns compositing off
//! by itself on the next one.
//!
//! Linux only. `WEBKIT_DISABLE_COMPOSITING_MODE` means nothing to WebView2 or
//! WKWebView, so on Windows and macOS none of this compiles in and there is no
//! misfire to worry about.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const STATE_FILE: &str = "gui-render-state.json";

pub const DISABLE_FLAG: &str = "--disable-gpu-compositing";
pub const ENABLE_FLAG: &str = "--gpu-compositing";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct RenderState {
    /// Set as a launch begins and cleared once the UI reports it has painted.
    /// Still set when the next launch reads it means the last one never got
    /// that far.
    pub startup_pending: bool,
    /// Sticky. Once compositing is off it stays off across restarts, until the
    /// user asks for it back.
    pub compositing_disabled: bool,
    /// Whether the line above was set by this code rather than by the user, so
    /// the UI can explain itself instead of leaving them wondering why the app
    /// looks different.
    pub disabled_automatically: bool,
}

/// What the user asked for on the command line, if anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlagRequest {
    Disable,
    Enable,
}

impl FlagRequest {
    pub fn from_args<I, S>(args: I) -> Option<Self>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        // Last one wins, matching how argument parsers usually behave when a
        // flag is repeated.
        let mut found = None;
        for arg in args {
            match arg.as_ref() {
                DISABLE_FLAG => found = Some(Self::Disable),
                ENABLE_FLAG => found = Some(Self::Enable),
                _ => {}
            }
        }
        found
    }
}

/// The decision for this launch, and the state to persist before the window
/// opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decision {
    pub disable_compositing: bool,
    /// True only on the launch that enters safe mode, so it is reported once
    /// rather than on every start afterwards.
    pub entered_safe_mode: bool,
    pub next_state: RenderState,
}

/// Pure so it can be tested without a filesystem or a window.
///
/// An explicit flag always beats the marker: someone passing `--gpu-compositing`
/// is overriding this, and having the marker quietly turn it off again would
/// make the flag look broken.
pub fn decide(previous: RenderState, flag: Option<FlagRequest>) -> Decision {
    let (disable, automatic, entered_safe_mode) = match flag {
        Some(FlagRequest::Disable) => (true, false, false),
        Some(FlagRequest::Enable) => (false, false, false),
        None => {
            if previous.compositing_disabled {
                // Already off, from a flag or from an earlier failed start.
                (true, previous.disabled_automatically, false)
            } else if previous.startup_pending {
                // Last launch began and never reported a painted frame.
                (true, true, true)
            } else {
                (false, false, false)
            }
        }
    };

    Decision {
        disable_compositing: disable,
        entered_safe_mode,
        next_state: RenderState {
            // Every launch re-arms the marker. `report_first_paint` clears it.
            startup_pending: true,
            compositing_disabled: disable,
            disabled_automatically: automatic,
        },
    }
}

fn state_path() -> Result<PathBuf, String> {
    let mut dir = dirs::config_dir()
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Could not resolve app config directory".to_string())?;
    dir.push("NetsCLI");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app config directory: {e}"))?;
    dir.push(STATE_FILE);
    Ok(dir)
}

/// A missing or unreadable state file reads as "nothing known", never as an
/// error. This runs before the window exists, so there is nowhere to report a
/// failure to, and refusing to start because a marker file is corrupt would be
/// a far worse bug than the one being worked around.
pub fn read_state() -> RenderState {
    let Ok(path) = state_path() else {
        return RenderState::default();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return RenderState::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn write_state(state: RenderState) {
    let Ok(path) = state_path() else { return };
    if let Ok(text) = serde_json::to_string_pretty(&state) {
        let _ = std::fs::write(path, text);
    }
}

/// Called from `main` before the Tauri builder runs, which is before the web
/// process is spawned and therefore before WebKit reads its environment.
///
/// A no-op off Linux. The two `#[tauri::command]`s below stay compiled on every
/// platform so the handler list and the frontend need no platform branching;
/// with nothing here ever arming the marker, they report the default.
pub fn apply() -> Option<Decision> {
    if !cfg!(target_os = "linux") {
        return None;
    }

    let flag = FlagRequest::from_args(std::env::args());
    let decision = decide(read_state(), flag);

    if decision.disable_compositing {
        // SAFE: single-threaded, before any thread or the webview starts.
        unsafe { std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1") };
        if decision.entered_safe_mode {
            eprintln!(
                "netscli-gui: the last launch never finished drawing, so hardware \
                 compositing is off for this one. Pass {ENABLE_FLAG} to turn it back on."
            );
        }
    }

    write_state(decision.next_state);
    Some(decision)
}

/// Reported by the UI once it has actually painted. Clearing the marker is what
/// stops the next launch from treating this one as a failure.
#[tauri::command]
pub fn report_first_paint() {
    let mut state = read_state();
    if state.startup_pending {
        state.startup_pending = false;
        write_state(state);
    }
}

// There is deliberately no command for reading this back into the UI yet.
// `disabled_automatically` is recorded so a toast can explain itself later, but
// nothing reads it today, and an accessor with no caller is a guess at what the
// eventual surface wants. The reason is printed to stderr and documented on the
// install page; the flag reverses it.

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> RenderState {
        RenderState::default()
    }

    #[test]
    fn a_clean_first_run_keeps_compositing() {
        let d = decide(fresh(), None);
        assert!(!d.disable_compositing);
        assert!(!d.entered_safe_mode);
        assert!(d.next_state.startup_pending, "the marker must be armed");
    }

    #[test]
    fn a_launch_that_never_painted_turns_compositing_off_next_time() {
        let previous = RenderState {
            startup_pending: true,
            ..fresh()
        };
        let d = decide(previous, None);
        assert!(d.disable_compositing);
        assert!(d.entered_safe_mode);
        assert!(d.next_state.disabled_automatically);
    }

    #[test]
    fn safe_mode_is_announced_once_not_on_every_later_start() {
        let after = decide(
            RenderState {
                startup_pending: true,
                ..fresh()
            },
            None,
        )
        .next_state;
        // That launch painted, so the marker cleared.
        let settled = RenderState {
            startup_pending: false,
            ..after
        };
        let d = decide(settled, None);
        assert!(d.disable_compositing, "the setting is sticky");
        assert!(!d.entered_safe_mode, "but it is only reported once");
    }

    #[test]
    fn the_enable_flag_overrides_a_marker_left_by_a_failed_start() {
        let previous = RenderState {
            startup_pending: true,
            compositing_disabled: true,
            disabled_automatically: true,
        };
        let d = decide(previous, Some(FlagRequest::Enable));
        assert!(
            !d.disable_compositing,
            "asking for compositing back must not be undone by the marker"
        );
        assert!(!d.next_state.compositing_disabled);
        assert!(!d.next_state.disabled_automatically);
    }

    #[test]
    fn the_disable_flag_is_remembered_but_not_reported_as_automatic() {
        let d = decide(fresh(), Some(FlagRequest::Disable));
        assert!(d.disable_compositing);
        assert!(d.next_state.compositing_disabled);
        assert!(!d.next_state.disabled_automatically);
        assert!(!d.entered_safe_mode);
    }

    #[test]
    fn the_last_flag_wins_when_both_are_passed() {
        let args = ["netscli-gui", DISABLE_FLAG, ENABLE_FLAG];
        assert_eq!(FlagRequest::from_args(args), Some(FlagRequest::Enable));
        let args = ["netscli-gui", ENABLE_FLAG, DISABLE_FLAG];
        assert_eq!(FlagRequest::from_args(args), Some(FlagRequest::Disable));
    }

    #[test]
    fn unrelated_arguments_are_ignored() {
        assert_eq!(
            FlagRequest::from_args(["netscli-gui", "--verbose", "somefile.json"]),
            None
        );
    }
}
