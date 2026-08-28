//! Tests for the pcap job lifecycle.
//!
//! In their own file because `jobs.rs` sits against the repository's
//! 300-line guard, which is the same reason `dispatch/` has
//! `tests.rs` and `policy_tests.rs` beside it.

use super::*;
use netscli_core::{PcapPacketSummary, PcapResult};
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

fn packet(index: usize) -> PcapPacketSummary {
    PcapPacketSummary {
        index,
        timestamp: "2026-08-28T00:00:00Z".to_string(),
        source: "192.0.2.1".to_string(),
        destination: "192.0.2.2".to_string(),
        protocol: "TCP".to_string(),
        length: 1500,
        captured_length: 1500,
        // Bytes off the wire. Whatever is on the link chooses these.
        info: "X".repeat(4000),
        source_port: Some(443),
        destination_port: Some(51000),
        tcp_flags: None,
        icmp_type: None,
        icmp_code: None,
        arp_operation: None,
        ethernet_source: None,
        ethernet_destination: None,
        hex_preview: Some("de ad be ef ".repeat(400)),
    }
}

fn completed_job(packets: usize) -> ServerState {
    let mut state = ServerState::default();
    let job = Arc::new(Mutex::new(PcapCaptureJob::new()));
    job.lock().unwrap().complete(PcapResult {
        packets_captured: packets,
        duration: Duration::from_secs(1),
        file_path: PathBuf::from("capture.pcap"),
        packets: (0..packets).map(packet).collect(),
        packets_truncated: false,
    });
    state.pcap_jobs.insert("pcap-1".to_string(), job);
    state
}

// The regression. `get_pcap_capture_result` is routed before
// `dispatch_tool`, so it never met the caps that every other tool result
// passes through -- while the blocking `capture_pcap` tool beside it did.
// A capture with no `maxPackets` (there is no default) put every byte of
// remote-chosen text into the model's context.
#[test]
fn a_finished_capture_is_capped_before_it_reaches_the_client() {
    let state = completed_job(2_000);

    let value = pcap_job_result(&state, json!({ "jobId": "pcap-1" })).unwrap();
    let encoded = serde_json::to_string(&value).unwrap();

    assert!(
        encoded.len() <= 1024 * 1024,
        "job result must be bounded; got {} bytes",
        encoded.len()
    );
    assert!(
        !encoded.contains(&"X".repeat(300)),
        "remote `info` must be truncated, not passed through whole"
    );
}

#[test]
fn a_small_capture_still_arrives_intact() {
    let state = completed_job(1);

    let value = pcap_job_result(&state, json!({ "jobId": "pcap-1" })).unwrap();

    assert_eq!(value["status"], "completed");
    assert_eq!(value["jobId"], "pcap-1");
    assert_eq!(value["result"]["packets_captured"], 1);
    assert_eq!(value["result"]["packets"][0]["protocol"], "TCP");
    assert_eq!(value["result"]["packets"][0]["source_port"], 443);
}
