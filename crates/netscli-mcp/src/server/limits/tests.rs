//! Tests for the result caps.
//!
//! In their own file because `limits.rs` passed the size guard when objects
//! over the cap started keeping their fields.

use super::*;
use serde_json::json;

#[test]
fn raw_is_dropped_and_banner_truncated() {
    let mut value = json!([{
        "port": 80,
        "banner": "A".repeat(5000),
        "raw": "B".repeat(4096),
        "service": "http",
    }]);
    cap_remote_text(&mut value);

    let entry = &value[0];
    assert!(entry.get("raw").is_none(), "raw must not reach the model");
    let banner = entry["banner"].as_str().unwrap();
    assert!(banner.ends_with("… (truncated)"));
    assert_eq!(
        banner.chars().count(),
        MAX_BANNER_CHARS + "… (truncated)".chars().count()
    );
    // Untouched fields survive.
    assert_eq!(entry["service"], "http");
    assert_eq!(entry["port"], 80);
}

#[test]
fn a_short_banner_is_left_exactly_as_it_was() {
    let mut value = json!([{ "banner": "SSH-2.0-OpenSSH_9.6p1" }]);
    cap_remote_text(&mut value);
    assert_eq!(value[0]["banner"], "SSH-2.0-OpenSSH_9.6p1");
}

#[test]
fn multibyte_banners_are_not_split_mid_character() {
    let mut value = json!([{ "banner": "\u{1f600}".repeat(1000) }]);
    cap_remote_text(&mut value);
    // Round-trips as valid UTF-8, which a byte-wise cut would not.
    assert!(value[0]["banner"]
        .as_str()
        .unwrap()
        .starts_with('\u{1f600}'));
}

#[test]
fn remote_text_in_http_replies_and_mdns_records_is_capped_too() {
    // The `Server` header was cut to 256 characters in `banner` and returned
    // whole beside it in `http.headers`.
    let long = "X".repeat(5000);
    let mut value = json!({
        "ports": [{
            "banner": long,
            "http": {
                "status_line": format!("HTTP/1.1 200 {long}"),
                "headers": [{ "name": "Server", "value": long }],
            },
        }],
        "services": [{
            "full_name": format!("{long}._http._tcp.local."),
            "hostname": format!("{long}.local."),
            "properties": { "note": long },
        }],
    });
    cap_remote_text(&mut value);

    let encoded = serde_json::to_string(&value).unwrap();
    assert!(
        !encoded.contains(&"X".repeat(MAX_BANNER_CHARS + 1)),
        "remote text survived uncapped: {encoded}"
    );
    assert_eq!(value["ports"][0]["http"]["headers"][0]["name"], "Server");
}

#[test]
fn an_oversized_array_is_truncated_and_says_so() {
    let items: Vec<Value> = (0..40_000)
        .map(|i| json!({ "port": i, "service": "x".repeat(64) }))
        .collect();
    let capped = cap_result_size(Value::Array(items));
    assert_eq!(capped["truncated"], true);
    assert_eq!(capped["total"], 40_000);
    assert!(serde_json::to_string(&capped).unwrap().len() <= MAX_RESULT_BYTES * 2);

    // The count the client reads has to be the count it received. This
    // assertion is the whole reason the bug survived: everything else
    // here was already checked.
    let actually_returned = capped["results"].as_array().unwrap().len();
    assert_eq!(capped["returned"], actually_returned);
    assert!(
        actually_returned < 40_000,
        "the fixture must actually truncate for this to mean anything"
    );
}

#[test]
fn a_small_result_passes_through_untouched() {
    let value = json!([{ "port": 22, "open": true }]);
    assert_eq!(cap_result_size(value.clone()), value);
}

#[test]
fn a_pcap_job_result_over_the_cap_keeps_its_fields_and_cuts_its_packets() {
    // `get_pcap_capture_result` returns packets under `result.packets`
    // rather than as a bare array, so this pins that both caps still reach
    // them. Built as JSON rather than from `PcapResult` so it runs without
    // the `pcap` feature -- the fields are the ones `PcapPacketSummary`
    // serializes.
    let packets: Vec<Value> = (0..20_000)
        .map(|i| {
            json!({
                "index": i,
                "protocol": "TCP",
                "info": "X".repeat(400),
                "hex_preview": "de ad be ef ".repeat(40),
            })
        })
        .collect();
    let job_result = json!({
        "jobId": "pcap-1",
        "status": "completed",
        "outputFile": "netscli-pcap-1-1.pcap",
        "result": {
            "file_path": "netscli-pcap-1-1.pcap",
            "packets_captured": 20_000,
            "packets": packets,
        },
    });

    let capped = cap_tool_result(job_result);
    let encoded = serde_json::to_string(&capped).unwrap();

    assert!(
        encoded.len() <= MAX_RESULT_BYTES,
        "a job result must not exceed the cap; got {} bytes",
        encoded.len()
    );
    assert!(
        !encoded.contains(&"X".repeat(MAX_BANNER_CHARS + 1)),
        "no untruncated remote `info` may survive"
    );

    // An object over the cap used to be replaced whole by an error, so the
    // job id, its status, the file and the count went with the packets.
    assert_eq!(capped["jobId"], "pcap-1");
    assert_eq!(capped["status"], "completed");
    assert_eq!(capped["result"]["file_path"], "netscli-pcap-1-1.pcap");
    assert_eq!(capped["result"]["packets_captured"], 20_000);
    let kept = capped["result"]["packets"].as_array().unwrap().len();
    assert!(kept > 0 && kept < 20_000, "kept {kept} packets");
    assert_eq!(capped["truncated"], true);
    assert_eq!(capped["returned"], kept);
    assert_eq!(capped["total"], 20_000);
}
