//! The exit codes `netscli` documents: 0 for success, 1 when the command ran
//! and failed, 2 when the command line itself was wrong.
//!
//! These run the real binary, because the code a shell sees is decided in
//! three places (clap, `main`'s `Result` and the command that returns the
//! error), and only the process shows all three agreeing. Nothing here needs
//! a network. Each case fails before any packet is sent or succeeds without
//! one.

use std::process::{Command, Output, Stdio};

fn netscli(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_netscli"))
        .args(args)
        .stdin(Stdio::null())
        // History is off by default, and these must not turn it on.
        .env_remove("NETSCLI_HISTORY")
        .env("NO_COLOR", "1")
        .output()
        .expect("run netscli")
}

fn code(args: &[&str]) -> i32 {
    netscli(args).status.code().expect("exited normally")
}

#[test]
fn a_command_line_clap_rejects_exits_2() {
    // `ping -c 0` used to print "loss=0.0%" for a ping that sent nothing.
    assert_eq!(code(&["ping", "127.0.0.1", "-c", "0"]), 2);
    assert_eq!(code(&["no-such-command"]), 2);
    assert_eq!(code(&["scan"]), 2);
}

#[test]
fn two_output_formats_are_a_usage_error_not_a_failed_command() {
    // These were runtime errors, so they exited 1 like a scan that failed.
    assert_eq!(code(&["scan", "127.0.0.1", "--json", "--yaml"]), 2);
    assert_eq!(code(&["discover", "--csv", "--md"]), 2);
    assert_eq!(code(&["dns", "localhost", "--json", "--csv"]), 2);
    assert_eq!(code(&["doctor", "--json", "--yaml"]), 2);
}

#[test]
fn a_command_that_runs_and_fails_exits_1() {
    // Port 0 is refused before any packet is sent.
    assert_eq!(code(&["scan", "127.0.0.1", "-p", "0"]), 1);
    assert_eq!(code(&["reverse", "not-an-ip"]), 1);
}

#[test]
fn mcp_service_install_installs_nothing_and_exits_1() {
    let out = netscli(&["mcp-service", "--install"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty(), "nothing is printed as a result");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("https://netscli.com/docs/mcp/"), "{stderr}");
}

#[test]
fn mcp_service_without_a_flag_is_a_usage_error() {
    // It used to print a usage line and exit 0.
    assert_eq!(code(&["mcp-service"]), 2);
    assert_eq!(code(&["mcp-service", "--install", "--uninstall"]), 2);
}

#[test]
fn commands_that_succeed_exit_0() {
    assert_eq!(code(&["--version"]), 0);
    assert_eq!(code(&["--help"]), 0);
    assert_eq!(code(&["completions", "bash"]), 0);
}
