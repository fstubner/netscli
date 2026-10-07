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
//! - `banner` and other remote text are truncated to something identifying
//!   rather than expansive.
//! - The whole response is capped, and says so when it truncates.
//!
//! Without these, `scan_ports` against a host that answers on every port
//! could return 4,096 × 4 KB of remote-chosen text in one response.

use serde_json::{json, Value};

/// Longest `banner` returned to a client.
///
/// Long enough for the version strings people actually identify services
/// by -- `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5` is 44 -- and short
/// enough that a wall of remote text cannot arrive one row at a time.
const MAX_BANNER_CHARS: usize = 256;

/// Ceiling on one serialized tool result.
const MAX_RESULT_BYTES: usize = 1024 * 1024;

/// Keys whose values are remote bytes rather than netscli's own findings.
const REMOTE_TEXT_KEYS: &[&str] = &["banner", "hex_preview", "info", "hostname", "full_name"];

/// Keys whose whole value is remote text, every string under them capped
/// like a banner: an HTTP reply's status line and headers, and an mDNS
/// service's TXT properties. The `Server` header was cut short in `banner`
/// and returned whole beside it in `http.headers`.
const REMOTE_TEXT_TREES: &[&str] = &["http", "properties"];

/// Room kept for the fields that say an object was cut.
const TRUNCATION_NOTE_BYTES: usize = 512;

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
                } else if REMOTE_TEXT_TREES.contains(&key.as_str()) {
                    cap_every_string(entry);
                } else {
                    cap_remote_text(entry);
                }
            }
        }
        _ => {}
    }
}

fn cap_every_string(value: &mut Value) {
    match value {
        Value::String(text) => truncate_chars(text, MAX_BANNER_CHARS),
        Value::Array(items) => items.iter_mut().for_each(cap_every_string),
        Value::Object(map) => map.values_mut().for_each(cap_every_string),
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

fn encoded_len(value: &Value) -> usize {
    serde_json::to_string(value).map(|s| s.len()).unwrap_or(0)
}

/// Cap the whole response, reporting what was dropped.
///
/// Truncating a list rather than erroring keeps a large scan useful: the
/// results that fit are still real, and the count says how many are missing
/// so the client can narrow its request instead of guessing.
pub(super) fn cap_result_size(value: Value) -> Value {
    let encoded = encoded_len(&value);
    if encoded <= MAX_RESULT_BYTES {
        return value;
    }
    match value {
        Value::Array(items) => cap_array(items),
        Value::Object(_) => cap_object(value, encoded),
        _ => too_large(encoded),
    }
}

fn cap_array(items: Vec<Value>) -> Value {
    let total = items.len();
    let kept = keep_fitting(items, MAX_RESULT_BYTES);
    // `kept.len()`, not the byte counter. `returned` was `used.min(total)`,
    // and `used` counts bytes -- so a 40,000-item result that kept 11,518
    // reported `returned: 40000, total: 40000` beside `truncated: true`,
    // telling the model it had everything while three quarters was cut.
    let returned = kept.len();
    json!({
        "results": kept,
        "truncated": true,
        "returned": returned,
        "total": total,
        "note": format!(
            "Result exceeded {MAX_RESULT_BYTES} bytes. Narrow the port or address range to see the rest."
        ),
    })
}

/// An object over the cap keeps every field except its largest list, which
/// is cut to fit as an oversized array is.
///
/// It used to be replaced whole by an error, so a capture too large to
/// return lost its file path and packet count along with its packets, and a
/// job result lost its id and status. The model learned nothing it could act
/// on, and for a capture with a made-up name, not even where the file was.
fn cap_object(mut value: Value, encoded: usize) -> Value {
    let Some((pointer, _)) = largest_list(&value, String::new()) else {
        return too_large(encoded);
    };
    let Some(Value::Array(items)) = value.pointer_mut(&pointer).map(Value::take) else {
        return too_large(encoded);
    };
    let total = items.len();
    let room = MAX_RESULT_BYTES.saturating_sub(encoded_len(&value) + TRUNCATION_NOTE_BYTES);
    if room == 0 {
        // Too large even without the list. Nothing sensible is left to cut.
        return too_large(encoded);
    }
    let kept = keep_fitting(items, room);
    let returned = kept.len();
    if let Some(slot) = value.pointer_mut(&pointer) {
        *slot = Value::Array(kept);
    }
    if let Value::Object(map) = &mut value {
        let field = pointer.trim_start_matches('/').replace('/', ".");
        map.insert("truncated".to_string(), json!(true));
        map.insert("returned".to_string(), json!(returned));
        map.insert("total".to_string(), json!(total));
        map.insert(
            "note".to_string(),
            json!(format!(
                "Result exceeded {MAX_RESULT_BYTES} bytes, so {field} holds the first {returned} of {total}. Ask for less to see the rest."
            )),
        );
    }
    value
}

/// The JSON pointer to the largest list in an object, and its size. Lists
/// inside lists are not searched: the outer list is always the larger.
fn largest_list(value: &Value, at: String) -> Option<(String, usize)> {
    let Value::Object(map) = value else {
        return None;
    };
    let mut largest: Option<(String, usize)> = None;
    for (key, entry) in map {
        let path = format!("{at}/{}", key.replace('~', "~0").replace('/', "~1"));
        let candidate = match entry {
            Value::Array(_) => Some((path, encoded_len(entry))),
            Value::Object(_) => largest_list(entry, path),
            _ => None,
        };
        if let Some(candidate) = candidate {
            if largest.as_ref().is_none_or(|(_, size)| candidate.1 > *size) {
                largest = Some(candidate);
            }
        }
    }
    largest
}

/// The leading items that fit in `budget` bytes.
fn keep_fitting(items: Vec<Value>, budget: usize) -> Vec<Value> {
    let mut kept = Vec::new();
    let mut used = 0usize;
    for item in items {
        let size = encoded_len(&item) + 1;
        if used + size > budget {
            break;
        }
        used += size;
        kept.push(item);
    }
    kept
}

fn too_large(encoded: usize) -> Value {
    // Nowhere sensible to cut. Say so rather than returning something that
    // looks complete.
    json!({
        "error": "result too large to return",
        "limit_bytes": MAX_RESULT_BYTES,
        "size_bytes": encoded,
    })
}

#[cfg(test)]
mod tests;
