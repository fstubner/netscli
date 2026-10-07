//! `netscli ... | head` closes the pipe after a few lines. That is the reader
//! saying it has seen enough, and it used to end in a panic message and exit
//! code 101, because `println!` panics when a write fails.
//!
//! The output has to be larger than a pipe holds, or the child finishes
//! writing before the reader hangs up and nothing is tested. A scan of 4,096
//! loopback ports is about half a megabyte of JSON and a second of work, and
//! touches nothing but this machine.

use std::io::Read;
use std::process::{Command, Stdio};

#[test]
fn a_reader_that_hangs_up_early_ends_the_output_quietly() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_netscli"))
        .args(["scan", "127.0.0.1", "-p", "1-4096", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NO_COLOR", "1")
        .env_remove("NETSCLI_HISTORY")
        .spawn()
        .expect("run netscli");

    // Read a little, then hang up, as `head` does.
    let mut stdout = child.stdout.take().expect("stdout");
    let mut first = [0u8; 64];
    stdout.read_exact(&mut first).expect("some output");
    drop(stdout);

    let out = child.wait_with_output().expect("netscli exits");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !stderr.contains("panicked"),
        "a closed pipe was reported as a panic:\n{stderr}"
    );
    assert_eq!(out.status.code(), Some(0), "stderr:\n{stderr}");
}
