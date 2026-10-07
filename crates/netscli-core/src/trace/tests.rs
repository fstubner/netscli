use super::*;

/// The target is passed to the tool as an argument, so one that starts
/// with a dash (or a slash, for Windows' `tracert`) is a flag to it. Without
/// the check, `trace_route("-d")` came back `Ok`, carrying the tool's
/// complaint that it had no target and its usage text.
#[tokio::test]
async fn a_target_that_looks_like_an_option_is_refused_before_the_tool_runs() {
    for host in ["-d", "--help", "-S", "/d", "/?", "   -d", ""] {
        let outcome = trace_route(host, 3, false, None).await;
        assert!(
            matches!(outcome, Err(Error::InvalidInput(_))),
            "{host:?} should be refused, got {outcome:?}"
        );
    }
}

#[test]
fn ordinary_targets_are_not_mistaken_for_options() {
    for host in [
        "example.com",
        "192.168.1.1",
        "::1",
        "fe80::1%12",
        "_dmarc.example.com",
        "münchen.example",
        "router-1.local.",
    ] {
        assert!(ensure_not_an_option(host).is_ok(), "{host:?}");
    }
}

/// Output that is not UTF-8 must not end the trace.
///
/// This is the kind of line a `tracert` in another language can write for a
/// timed-out hop, and it is the only way to reach the failure: the English
/// output this code was written against is plain ASCII, so nothing else in
/// the suite (or on an English CI runner) can fail here. A real child
/// process is used rather than a byte slice because the strict read
/// happened in the select loop, around the pipe.
#[tokio::test]
async fn output_that_is_not_utf8_does_not_abort_the_trace() {
    let dir = tempfile::tempdir().expect("temp dir");
    let file = dir.path().join("tracert.txt");
    // 0x81 is "ü" in code page 850 and cannot appear in UTF-8 on its own.
    std::fs::write(
        &file,
        b"  1    <1 ms    <1 ms    <1 ms  192.168.0.1\r\n  2     *        *        *     Zeit\x81berschreitung der Anforderung.\r\n\r\nTrace complete.\r\n",
    )
    .expect("write fixture");
    let path = file.display().to_string();

    // Both print the file's bytes unchanged.
    #[cfg(windows)]
    let (tool, args) = ("cmd", vec!["/c".to_string(), "type".to_string(), path]);
    #[cfg(not(windows))]
    let (tool, args) = ("cat", vec![path]);

    let result = run_command_streaming(tool, &args, "192.168.0.1", None)
        .await
        .expect("a trace whose output is not UTF-8 still completes");

    assert_eq!(result.exit_code, Some(0));
    assert_eq!(
        result.lines.first().map(String::as_str),
        Some("  1    <1 ms    <1 ms    <1 ms  192.168.0.1"),
        "the hops printed before the odd byte are kept"
    );
    let timed_out = result
        .lines
        .iter()
        .find(|line| line.trim_start().starts_with("2 "))
        .expect("the hop with the odd byte is kept too");
    assert!(
        timed_out.contains("Zeit\u{FFFD}berschreitung"),
        "the odd byte becomes a replacement character: {timed_out:?}"
    );
    assert_eq!(
        result.lines.last().map(String::as_str),
        Some("Trace complete."),
        "and so are the lines after it"
    );
}
