//! Bounding what a scanned host can put into the model's context.
//!
//! Scan results are not the server's data. `banner` and `raw` are bytes read
//! straight off a remote socket, hostnames come from whoever runs the
//! reverse zone, and mDNS names come from anything on the link. On the CLI
//! that content is sanitised for the *terminal* and a human reads it. Here
//! it goes to a model, where the interesting failure is different: text that
//! reads as instructions, in a channel the model treats as tool output.
//!
//! Nothing can make remote text safe to feed a model. What this does is keep
//! the quantity small enough to be visibly data rather than a document, and
//! keep one scan from filling a context window:
//!
//! - `raw` is dropped. It is the full probe response, it exists for the
//!   GUI's detail pane, and no model needs 4 KB of it.
//! - `banner` is truncated to something identifying rather than expansive.
//! - The whole response is capped, and says so when it truncates.
//!
//! Without these, `scan_ports` against a host that answers on every port
//! could return 4,096 × 4 KB of remote-chosen text in one response.

use serde_json::Value;

/// Longest `banner` returned to a client.
///
/// Long enough for the version strings people actually identify services
/// by -- `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5` is 44 -- and short
/// enough that a wall of remote text cannot arrive one row at a time.
const MAX_BANNER_CHARS: usize = 256;

/// Ceiling on one serialized tool result.
const MAX_RESULT_BYTES: usize = 1024 * 1024;

/// Keys whose values are remote bytes rather than netscli's own findings.
const REMOTE_TEXT_KEYS: &[&str] = &["banner", "hex_preview", "info"];

/// Both caps, in the order they have to run: strip and truncate the remote
/// text first, then bound what is left.
///
/// `dispatch_tool` is the choke point for every stateless tool. The pcap job
/// tools are routed before it — they need the server's job map — so they call
/// this directly.
pub(super) fn cap_tool_result(mut value: Value) -> Value {
    cap_remote_text(&mut value);
    cap_result_size(value)
}

/// Strip and truncate remote-supplied text throughout a result.
pub(super) fn cap_remote_text(value: &mut Value) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(cap_remote_text),
        Value::Object(map) => {
            // The full probe response, kept for the GUI's detail pane. A
            // model has no use for it and it is the single largest source of
            // attacker-chosen bytes in a result.
            map.remove("raw");
            for (key, entry) in map.iter_mut() {
                if REMOTE_TEXT_KEYS.contains(&key.as_str()) {
                    if let Value::String(text) = entry {
                        truncate_chars(text, MAX_BANNER_CHARS);
                    }
                } else {
                    cap_remote_text(entry);
                }
            }
        }
        _ => {}
    }
}

fn truncate_chars(text: &mut String, max: usize) {
    if text.chars().count() <= max {
        return;
    }
    // Counted in chars, not bytes, so this cannot split a UTF-8 sequence.
    let kept: String = text.chars().take(max).collect();
    *text = format!("{kept}… (truncated)");
}

/// Cap the whole response, reporting what was dropped.
///
/// Truncating the array rather than erroring keeps a large scan useful: the
/// results that fit are still real, and the count says how many are missing
/// so the client can narrow its request instead of guessing.
pub(super) fn cap_result_size(value: Value) -> Value {
    let encoded = serde_json::to_string(&value).map(|s| s.len()).unwrap_or(0);
    if encoded <= MAX_RESULT_BYTES {
        return value;
    }
    let Value::Array(items) = value else {
        // Not an array, so there is no natural place to cut. Say so rather
        // than returning something that looks complete.
        return serde_json::json!({
            "error": "result too large to return",
            "limit_bytes": MAX_RESULT_BYTES,
            "size_bytes": encoded,
        });
    };

    let total = items.len();
    let mut kept: Vec<Value> = Vec::new();
    let mut used = 0usize;
    for item in items {
        let size = serde_json::to_string(&item).map(|s| s.len()).unwrap_or(0) + 1;
        if used + size > MAX_RESULT_BYTES {
            break;
        }
        used += size;
        kept.push(item);
    }
    // `kept.len()`, not the byte counter. `returned` was `used.min(total)`,
    // and `used` counts bytes -- so a 40,000-item result that kept 11,518
    // reported `returned: 40000, total: 40000` beside `truncated: true`,
    // telling the model it had everything while three quarters was cut.
    let returned = kept.len();
    serde_json::json!({
        "results": kept,
        "truncated": true,
        "returned": returned,
        "total": total,
        "note": format!(
            "Result exceeded {MAX_RESULT_BYTES} bytes. Narrow the port or address range to see the rest."
        ),
    })
}

#[cfg(test)]
mod tests {
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
    fn a_pcap_job_result_is_capped_through_its_nesting() {
        // `get_pcap_capture_result` returns packets under `result.packets`
        // rather than as a bare array, so this pins that both caps still
        // reach them. Built as JSON rather than from `PcapResult` so it runs
        // without the `pcap` feature -- the fields are the ones
        // `PcapPacketSummary` serializes.
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
            "result": { "packets_captured": 20_000, "packets": packets },
        });

        let capped = cap_tool_result(job_result);
        let encoded = serde_json::to_string(&capped).unwrap();

        // Not an array at the top level, so `cap_result_size` cannot trim it
        // item by item and says so instead of returning something that looks
        // complete. Either way the wall of remote text does not arrive.
        assert!(
            encoded.len() <= MAX_RESULT_BYTES,
            "a job result must not exceed the cap; got {} bytes",
            encoded.len()
        );
        assert!(
            !encoded.contains(&"X".repeat(MAX_BANNER_CHARS + 1)),
            "no untruncated remote `info` may survive"
        );
    }
}
