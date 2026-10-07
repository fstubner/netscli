use super::*;
use ratatui::text::Line;

fn done(command: &str, output: Vec<Line<'static>>) -> HistoryEntry {
    HistoryEntry {
        command: command.to_string(),
        output,
        state: EntryState::Done,
    }
}

#[test]
fn a_markdown_export_carries_no_escape_sequences() {
    // An mDNS name or a TXT value a remote host chose, as the TUI stores
    // it. ESC here would run when the file is printed to a terminal.
    let history = vec![done(
        "/mdns",
        vec![Line::from(
            "evil\u{1b}[31m\u{1b}]52;c;ZWNobw==\u{7}  [10.0.0.9]",
        )],
    )];
    let md = render_markdown(&history);
    assert!(!md.contains('\u{1b}'), "ESC reached the file: {md:?}");
    assert!(!md.contains('\u{7}'), "BEL reached the file: {md:?}");
    assert!(md.contains("evil.[31m"), "the name vanished: {md:?}");
}

#[test]
fn a_markdown_export_carries_no_bidi_overrides() {
    let history = vec![done(
        "/dns example.com",
        vec![Line::from("v=spf1 \u{202E}ssap\u{200B}")],
    )];
    let md = render_markdown(&history);
    assert!(!md.contains('\u{202E}') && !md.contains('\u{200B}'));
}

fn output_of(input: &str) -> PathBuf {
    parse_export_command(input)
        .unwrap()
        .output
        .expect("an --output")
}

#[test]
fn a_windows_path_keeps_its_backslashes() {
    // A shell-style splitter read this as `C:Usersmeout.md`, a path relative
    // to the current directory on drive C.
    assert_eq!(
        output_of(r"/export --output C:\Users\me\out.md"),
        PathBuf::from(r"C:\Users\me\out.md")
    );
    assert_eq!(
        output_of(r#"/export md -o "C:\My Scans\out.md""#),
        PathBuf::from(r"C:\My Scans\out.md")
    );
    assert_eq!(
        output_of(r"/export -o \\server\share\out.md"),
        PathBuf::from(r"\\server\share\out.md")
    );
}

#[test]
fn a_leading_tilde_is_the_home_directory() {
    let Some(home) = home_dir() else {
        return;
    };
    assert_eq!(
        output_of("/export -o ~/scans/out.md"),
        home.join("scans/out.md")
    );
    assert_eq!(
        output_of(r"/export -o ~\scans\out.md"),
        home.join(r"scans\out.md")
    );
    // Only a `~` that stands alone as the first part of the path counts.
    assert_eq!(
        output_of("/export -o ~backup/out.md"),
        PathBuf::from("~backup/out.md")
    );
    assert_eq!(
        output_of("/export -o notes/~/out.md"),
        PathBuf::from("notes/~/out.md")
    );
}

#[test]
fn the_format_and_flags_still_parse() {
    let request = parse_export_command("/export json").unwrap();
    assert_eq!(request.format, ExportFormat::Json);
    assert!(request.output.is_none());

    assert!(parse_export_command("/export --bogus").is_err());
    assert!(parse_export_command("/export yaml").is_err());
    assert!(parse_export_command("/export -o").is_err());
    assert!(parse_export_command(r#"/export -o "never closed"#).is_err());
}
