//! Gate 1 baseline: traceroute contract.
//!
//! Phase 1 of IMPLEMENTATION_PLAN.md replaces the subprocess shell-out with
//! an in-process Paris tracer. The plan promises `TraceResult` and its
//! `lines: Vec<String>` output survive that. This pins the promise.
//!
//! Two things worth knowing before adding to this file.
//!
//! `lines` is currently the external tool's own stdout, accumulated in
//! `trace.rs`. Synthesising it in-process will produce *different text* even
//! though the type is unchanged, so anything asserting exact line format
//! here would have to be rewritten by Phase 1 -- which would make it a
//! ratchet, not a gate. These assert invariants that should hold for either
//! implementation.
//!
//! And the tool is not guaranteed to exist: GitHub's Ubuntu runners ship
//! neither `traceroute` nor `tracepath`. A test that requires a successful
//! trace would fail there for a reason unrelated to netscli, so these accept
//! a clean error as a valid outcome. Phase 1 removes that caveat by removing
//! the dependency -- at which point the `is_err()` arms become dead and
//! should be tightened.

use netscli_core::trace::trace_route;

#[tokio::test]
async fn a_trace_returns_a_result_or_a_clean_error_never_a_panic() {
    // Loopback: at most one hop, and no packet leaves the machine.
    let outcome = trace_route("127.0.0.1", 3, false, None).await;

    match outcome {
        Ok(result) => {
            assert_eq!(result.host, "127.0.0.1", "the result must name its target");
            assert!(
                !result.tool.is_empty(),
                "the result must say what produced it"
            );
        }
        Err(error) => {
            // Acceptable only while this shells out. See the module note.
            let message = error.to_string();
            assert!(!message.is_empty(), "an error must explain itself");
        }
    }
}

#[tokio::test]
async fn trace_output_carries_no_terminal_control_sequences() {
    // Hop names come from PTR records of routers on the path, which whoever
    // runs those routers controls. An ESC reaching a terminal can repaint
    // the screen and forge the output above it, so nothing in `lines` may
    // carry one -- whoever produces those lines.
    let Ok(result) = trace_route("127.0.0.1", 3, false, None).await else {
        // No tracer available; nothing to inspect.
        return;
    };

    for line in &result.lines {
        assert!(
            !line.chars().any(|c| c.is_control() && c != '\t'),
            "control character in trace output: {line:?}"
        );
    }
}

#[tokio::test]
async fn a_trace_result_serializes_with_the_fields_downstream_reads() {
    // `--json`, the MCP layer and the GUI all read these names.
    let Ok(result) = trace_route("127.0.0.1", 2, false, None).await else {
        return;
    };

    let value = serde_json::to_value(&result).expect("TraceResult serializes");
    for key in ["host", "tool", "lines"] {
        assert!(value.get(key).is_some(), "missing {key}: {value}");
    }
    assert!(value["lines"].is_array(), "lines must stay an array");
}

#[tokio::test]
async fn an_unresolvable_host_fails_instead_of_hanging() {
    // `.invalid` is reserved by RFC 2606 and never resolves.
    let started = std::time::Instant::now();
    let _ = trace_route("no-such-host.invalid", 2, false, None).await;
    assert!(
        started.elapsed().as_secs() < 60,
        "an unresolvable target should not hang: {:?}",
        started.elapsed()
    );
}
