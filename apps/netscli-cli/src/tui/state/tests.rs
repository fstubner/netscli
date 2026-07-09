use super::*;
use ratatui::backend::TestBackend;
use ratatui::Terminal;

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
fn config_next_and_prev_move_selection_within_bounds() {
    let mut app = TuiApp::new();
    app.enter_config();
    let len = app.config_state_mut().expect("config mode active").len();
    assert!(
        len > 1,
        "config menu should have more than one item to navigate"
    );

    assert_eq!(app.config_state_mut().unwrap().selected, 0);

    app.config_prev();
    assert_eq!(
        app.config_state_mut().unwrap().selected,
        0,
        "config_prev() at the first item should stay clamped at 0"
    );

    for _ in 0..(len + 2) {
        app.config_next();
    }
    assert_eq!(
        app.config_state_mut().unwrap().selected,
        len - 1,
        "config_next() should clamp at the last item, not wrap or overrun"
    );

    app.config_prev();
    assert_eq!(app.config_state_mut().unwrap().selected, len - 2);
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
