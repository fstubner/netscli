//! `--csv`: the same data `--json` prints, one row per result, for a
//! spreadsheet or a script that wants columns.
//!
//! Columns are the JSON field names, so moving between `--json` and `--csv`
//! renames nothing. They come from serializing the result, not from a list
//! kept here, so a field added to a result type shows up in both formats at
//! once and the two cannot drift.
//!
//! Cell rules:
//!
//! - null is an empty cell, numbers and booleans print as JSON writes them;
//! - a list of plain values is joined with `;` (`22;80;443`);
//! - anything nested -- an HTTP probe, a TLS probe, mDNS TXT properties -- is
//!   the compact JSON of that value, in one cell, so the column set stays the
//!   same from row to row and from run to run.
//!
//! JSON is still the lossless format. CSV has no escape for a control
//! character, so the ones that can hurt are replaced; see [`escape`].

use anyhow::Result;
use serde::de::{Deserializer, MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

/// One serialized result, its fields in the order the struct declares them.
///
/// Deserialized by hand because `serde_json::Value` sorts object keys (this
/// workspace does not enable `preserve_order`), and a CSV whose columns come
/// out alphabetical -- `found_by` before `ip` -- reads as nobody's design.
struct Row(Vec<(String, Value)>);

impl<'de> Deserialize<'de> for Row {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct RowVisitor;

        impl<'de> Visitor<'de> for RowVisitor {
            type Value = Row;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a JSON object")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Row, A::Error> {
                let mut fields = Vec::new();
                while let Some((key, value)) = map.next_entry::<String, Value>()? {
                    fields.push((key, value));
                }
                Ok(Row(fields))
            }
        }

        deserializer.deserialize_map(RowVisitor)
    }
}

/// Render a result as CSV: a list becomes one row per item, a single object
/// becomes one row. An empty list renders as an empty string -- there is no
/// row to take the column names from.
pub(crate) fn to_csv<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    let json = serde_json::to_string(value)?;
    let rows: Vec<Row> = if json.trim_start().starts_with('[') {
        serde_json::from_str(&json)?
    } else {
        vec![serde_json::from_str(&json)?]
    };
    Ok(render(&rows))
}

fn render(rows: &[Row]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let header = header(rows);
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(
        header
            .iter()
            .map(|name| escape(name))
            .collect::<Vec<_>>()
            .join(","),
    );
    for row in rows {
        let cells = header.iter().map(|name| {
            let cell = row
                .0
                .iter()
                .find(|(key, _)| key == name)
                .map_or_else(String::new, |(_, value)| cell_text(value));
            escape(&cell)
        });
        lines.push(cells.collect::<Vec<_>>().join(","));
    }
    lines.join("\n")
}

/// Every key any row has, in declaration order.
///
/// Result types skip `None` fields when they serialize, so the first row is
/// not a complete list: a host with no name has no `hostname` key at all.
/// A key first seen in a later row goes in straight after the key that came
/// before it in that row, which puts it back where the struct declares it
/// rather than at the end.
fn header(rows: &[Row]) -> Vec<String> {
    let mut header: Vec<String> = Vec::new();
    for row in rows {
        let mut previous: Option<usize> = None;
        for (key, _) in &row.0 {
            match header.iter().position(|name| name == key) {
                Some(index) => previous = Some(index),
                None => {
                    let at = previous.map_or(0, |index| index + 1);
                    header.insert(at, key.clone());
                    previous = Some(at);
                }
            }
        }
    }
    header
}

fn cell_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Array(items) if items.iter().all(is_plain) => {
            items.iter().map(cell_text).collect::<Vec<_>>().join(";")
        }
        Value::Bool(_) | Value::Number(_) | Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

fn is_plain(value: &Value) -> bool {
    !matches!(value, Value::Array(_) | Value::Object(_))
}

/// Quote a cell for CSV, and defuse the two ways a scanned host's own text
/// could do harm on the way to a spreadsheet or a terminal.
///
/// Formulas: a banner, hostname or mDNS name is text the host chose, and a
/// spreadsheet runs a cell that starts with `=`, `+`, `-` or `@` as a
/// formula. Those cells get a leading `'`, the same rule the desktop app's CSV
/// export applies (`csvEscape` in apps/netscli-gui). A cell that parses as a
/// number is left alone, so a negative figure stays a number.
///
/// Control characters: `--csv` often prints straight to a terminal, and an
/// escape sequence in a banner would be run there -- the attack
/// `sanitize_for_terminal` exists for. Every control character becomes `.`,
/// as it does in text output, except tab, CR and LF, which CSV carries inside
/// a quoted cell and a multi-line banner needs.
fn escape(cell: &str) -> String {
    let cleaned: String = cell
        .chars()
        .map(|c| {
            if c.is_control() && !matches!(c, '\t' | '\r' | '\n') {
                '.'
            } else {
                c
            }
        })
        .collect();
    let numeric = cleaned.parse::<f64>().is_ok_and(f64::is_finite);
    let guarded = if !numeric && cleaned.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{cleaned}")
    } else {
        cleaned
    };
    if guarded.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", guarded.replace('"', "\"\""))
    } else {
        guarded
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize)]
    struct Host {
        ip: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        hostname: Option<&'static str>,
        rtt_ms: Option<u64>,
        ports: Vec<u16>,
    }

    #[test]
    fn columns_follow_the_struct_not_the_alphabet() {
        let csv = to_csv(&[Host {
            ip: "10.0.0.1",
            hostname: Some("nas"),
            rtt_ms: Some(3),
            ports: vec![],
        }])
        .unwrap();
        assert_eq!(csv.lines().next().unwrap(), "ip,hostname,rtt_ms,ports");
    }

    #[test]
    fn a_field_skipped_in_the_first_row_still_lands_in_its_place() {
        let csv = to_csv(&[
            Host {
                ip: "10.0.0.1",
                hostname: None,
                rtt_ms: None,
                ports: vec![],
            },
            Host {
                ip: "10.0.0.2",
                hostname: Some("nas"),
                rtt_ms: Some(3),
                ports: vec![22, 80],
            },
        ])
        .unwrap();
        assert_eq!(
            csv,
            "ip,hostname,rtt_ms,ports\n10.0.0.1,,,\n10.0.0.2,nas,3,22;80"
        );
    }

    #[test]
    fn a_single_object_is_one_row() {
        #[derive(Serialize)]
        struct Summary {
            host: &'static str,
            loss_pct: f64,
        }
        let csv = to_csv(&Summary {
            host: "router",
            loss_pct: 25.0,
        })
        .unwrap();
        assert_eq!(csv, "host,loss_pct\nrouter,25.0");
    }

    #[test]
    fn nothing_found_prints_nothing() {
        let empty: Vec<Host> = Vec::new();
        assert_eq!(to_csv(&empty).unwrap(), "");
    }

    #[test]
    fn nested_values_stay_in_one_cell_as_json() {
        #[derive(Serialize)]
        struct Port {
            port: u16,
            http: Probe,
        }
        #[derive(Serialize)]
        struct Probe {
            status_line: &'static str,
        }
        let csv = to_csv(&[Port {
            port: 80,
            http: Probe {
                status_line: "HTTP/1.1 200 OK",
            },
        }])
        .unwrap();
        assert_eq!(
            csv,
            "port,http\n80,\"{\"\"status_line\"\":\"\"HTTP/1.1 200 OK\"\"}\""
        );
    }

    #[test]
    fn commas_quotes_and_newlines_are_quoted() {
        assert_eq!(escape("a,b"), "\"a,b\"");
        assert_eq!(escape("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(escape("line one\r\nline two"), "\"line one\r\nline two\"");
        assert_eq!(escape("plain"), "plain");
    }

    #[test]
    fn a_host_cannot_plant_a_formula() {
        assert_eq!(
            escape("=HYPERLINK(\"http://x\")"),
            "\"'=HYPERLINK(\"\"http://x\"\")\""
        );
        assert_eq!(escape("+cmd"), "'+cmd");
        assert_eq!(escape("-cmd"), "'-cmd");
        assert_eq!(escape("@SUM(A1)"), "'@SUM(A1)");
    }

    #[test]
    fn negative_numbers_stay_numbers() {
        assert_eq!(escape("-1"), "-1");
        assert_eq!(escape("-12.5"), "-12.5");
    }

    #[test]
    fn a_host_cannot_send_escape_sequences_to_the_terminal() {
        assert_eq!(escape("\u{1b}[31mred"), ".[31mred");
        assert_eq!(escape("bell\u{7}"), "bell.");
    }
}
