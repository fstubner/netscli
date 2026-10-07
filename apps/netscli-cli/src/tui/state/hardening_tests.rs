//! What the TUI must not do with text it did not write, text pasted at it,
//! half a command, a smaller terminal than it expected, or a request for no
//! colour. Split from `tests.rs`, which holds the everyday state tests.

use super::tests::{render_to_lines, type_text};
use super::*;
use ratatui::backend::TestBackend;
use ratatui::Terminal;

#[test]
fn no_color_draws_the_whole_frame_without_colour() {
    use ratatui::style::Color;

    let mut app = TuiApp::new();

    let mut coloured = Terminal::new(TestBackend::new(80, 24)).expect("terminal");
    app.draw_with(&mut coloured, false).expect("draw");
    let cells = &coloured.backend().buffer().content;
    assert!(
        cells.iter().any(|cell| cell.fg != Color::Reset),
        "the banner should be coloured"
    );

    let mut plain = Terminal::new(TestBackend::new(80, 24)).expect("terminal");
    app.draw_with(&mut plain, true).expect("draw");
    let cells = &plain.backend().buffer().content;
    assert!(cells
        .iter()
        .all(|cell| cell.fg == Color::Reset && cell.bg == Color::Reset));
}

#[test]
fn drawing_survives_any_terminal_size() {
    // A terminal gets resized to almost nothing often enough, and a panic
    // here would take the session with it. The layout does its sums in
    // saturating arithmetic, and this is what keeps that true.
    for (width, height) in [(1, 1), (2, 2), (10, 3), (30, 4), (200, 2), (3, 40), (80, 1)] {
        let mut app = TuiApp::new();
        render_to_lines(&mut app, width, height);

        // With a running command, suggestions and the exit prompt as well,
        // which each add to what has to fit.
        app.running = true;
        app.suggestions = COMMAND_DEFS.iter().copied().take(6).collect();
        app.confirm_exit = true;
        render_to_lines(&mut app, width, height);
    }
}

#[test]
fn enter_on_a_partial_command_completes_it_instead_of_running_it() {
    let mut app = TuiApp::new();
    type_text(&mut app, "/e");
    app.update_suggestions();

    // `/e` used to run `/export`, the first suggestion, which writes a file,
    // when the user was heading for `/exit`.
    assert!(app.enter_completes_command("/e"));
    app.apply_tab_completion();
    assert_eq!(app.input.lines().join("\n"), "/export");

    // Now it is a whole command, so Enter runs it, and so it does for
    // anything with arguments or that is not a command at all.
    assert!(!app.enter_completes_command("/export"));
    assert!(!app.enter_completes_command("/scan 10.0.0.1"));
    assert!(!app.enter_completes_command("hello"));
}

#[test]
fn a_paste_is_text_and_never_a_keypress() {
    let mut app = TuiApp::new();
    // A second line that would have run on its own.
    app.paste("/scan 10.0.0.5\n/arp clear\r\n");
    assert_eq!(app.input.lines().len(), 1);
    assert_eq!(app.input.lines().join("\n"), "/scan 10.0.0.5 /arp clear");

    let mut app = TuiApp::new();
    app.paste("evil\u{1b}[2Jname\there");
    assert_eq!(app.input.lines().join("\n"), "evil[2Jname here");
}

#[test]
fn stored_output_has_remote_text_cleaned() {
    use crate::tui::EntryState;
    use ratatui::text::{Line, Span};

    let mut app = TuiApp::new();
    app.push_command("/mdns".to_string());
    app.finish_current(vec![Line::from(vec![
        Span::raw("evil\u{1b}[31m"),
        Span::raw(" name\u{202E}fdp"),
    ])]);

    let entry = &app.history[0];
    assert_eq!(entry.state, EntryState::Done);
    assert_eq!(entry.output[0].to_string(), "evil.[31m name.fdp");
}

#[test]
fn the_host_label_asks_the_system_before_the_environment() {
    let name = |s: &str| Some(s.to_string());
    // zsh does not export HOSTNAME, so the system's answer is the one to use.
    assert_eq!(host_label(name("MacBook"), None, None), "macbook");
    assert_eq!(host_label(name("Real"), name("stale"), name("OLD")), "real");
    // Only when the system will not say do the variables count.
    assert_eq!(host_label(None, name("Box"), name("BOX2")), "box");
    assert_eq!(
        host_label(name(""), None, name("WORKSTATION")),
        "workstation"
    );
    assert_eq!(host_label(None, None, None), "n/a");
}
