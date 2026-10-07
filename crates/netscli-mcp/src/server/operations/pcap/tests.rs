//! How the capture tools set up a capture: its duration and its file.
//!
//! In their own file because `pcap.rs` is near the size guard.

use std::path::{Path, PathBuf};

use super::*;

fn params(duration: Option<u64>, max_packets: Option<u64>) -> PcapParams {
    PcapParams {
        interface: "netscli-test0".to_string(),
        filter: None,
        duration,
        output_file: None,
        max_packets,
    }
}

/// An empty directory of this test's own.
fn scratch_dir(test: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("netscli-mcp-{test}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A request writing to `path`. The tools only take a bare filename, in the
/// server's working directory, and a test must not write there.
fn request_for(path: &Path) -> PcapCaptureRequest {
    PcapCaptureRequest {
        interface: "netscli-test0".to_string(),
        filter: None,
        duration: Some(1),
        output_file: Some(path.to_string_lossy().into_owned()),
        max_packets: None,
    }
}

#[test]
fn a_blocking_capture_always_has_a_duration_within_the_clamp() {
    // `maxPackets` alone fell through to core's one-hour ceiling.
    let request = interactive_request(params(None, Some(5))).unwrap();
    assert_eq!(
        request.duration,
        Some(netscli_core::DEFAULT_PCAP_CAPTURE_SECONDS)
    );

    let request = interactive_request(params(Some(3_600), None)).unwrap();
    assert_eq!(request.duration, Some(MAX_INTERACTIVE_CAPTURE_SECONDS));
}

#[test]
fn an_existing_file_is_never_replaced() {
    let dir = scratch_dir("existing");
    let path = dir.join("capture.pcap");
    std::fs::write(&path, b"keep me").unwrap();

    let err = request_for(&path)
        .claim_output_file(String::new())
        .unwrap_err();

    assert!(err.to_string().contains("already exists"), "{err}");
    assert_eq!(std::fs::read(&path).unwrap(), b"keep me");
}

#[cfg(unix)]
#[test]
fn a_symlink_at_the_name_is_not_followed() {
    let dir = scratch_dir("symlink");
    let target = dir.join("elsewhere.txt");
    std::fs::write(&target, b"keep me").unwrap();
    let link = dir.join("capture.pcap");
    std::os::unix::fs::symlink(&target, &link).unwrap();

    assert!(request_for(&link).claim_output_file(String::new()).is_err());
    assert_eq!(std::fs::read(&target).unwrap(), b"keep me");

    // Nor one that points nowhere, which would create the file it names.
    let dangling = dir.join("dangling.pcap");
    std::os::unix::fs::symlink(dir.join("nowhere"), &dangling).unwrap();
    assert!(request_for(&dangling)
        .claim_output_file(String::new())
        .is_err());
    assert!(!dir.join("nowhere").exists());
}

#[tokio::test]
async fn a_capture_that_cannot_start_leaves_no_file_behind() {
    let dir = scratch_dir("cannot-start");
    let path = dir.join("capture.pcap");
    let mut request = request_for(&path);
    request.claim_output_file(String::new()).unwrap();
    assert!(path.exists());

    let outcome = run_pcap_capture(request, netscli_core::PcapCancelToken::new()).await;

    assert!(outcome.is_err(), "there is no interface netscli-test0");
    assert!(!path.exists(), "the empty file made for it must go");
}
