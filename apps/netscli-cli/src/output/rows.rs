//! What `--csv` and `--md` share: a result read back as rows, the columns
//! every row has, and the text of one cell. Each format then does its own
//! quoting.
//!
//! Columns are the JSON field names, so moving between `--json` and a table
//! format renames nothing. They come from serializing the result, not from a
//! list kept here, so a field added to a result type shows up in every format
//! at once and they cannot drift.
//!
//! Cell rules:
//!
//! - null is an empty cell, numbers and booleans print as JSON writes them;
//! - a list of plain values is joined with `;` (`22;80;443`);
//! - anything nested -- an HTTP probe, a TLS probe, mDNS TXT properties -- is
//!   the compact JSON of that value, in one cell, so the column set stays the
//!   same from row to row and from run to run.

use anyhow::Result;
use serde::de::{Deserializer, MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

/// One serialized result, its fields in the order the struct declares them.
///
/// Deserialized by hand because `serde_json::Value` sorts object keys (this
/// workspace does not enable `preserve_order`), and a table whose columns come
/// out alphabetical -- `found_by` before `ip` -- reads as nobody's design.
pub(super) struct Row(pub(super) Vec<(String, Value)>);

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

/// A result as rows: a list becomes one row per item, a single object one row.
pub(super) fn rows_of<T: Serialize + ?Sized>(value: &T) -> Result<Vec<Row>> {
    let json = serde_json::to_string(value)?;
    Ok(if json.trim_start().starts_with('[') {
        serde_json::from_str(&json)?
    } else {
        vec![serde_json::from_str(&json)?]
    })
}

impl Row {
    /// The text of this row's `column` cell, empty when the row has no such key.
    pub(super) fn cell(&self, column: &str) -> String {
        self.0
            .iter()
            .find(|(key, _)| key == column)
            .map_or_else(String::new, |(_, value)| cell_text(value))
    }
}

/// Every key any row has, in declaration order.
///
/// Result types skip `None` fields when they serialize, so the first row is
/// not a complete list: a host with no name has no `hostname` key at all.
/// A key first seen in a later row goes in straight after the key that came
/// before it in that row, which puts it back where the struct declares it
/// rather than at the end.
pub(super) fn header(rows: &[Row]) -> Vec<String> {
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

/// Replace control characters with `.`, except the whitespace a format can
/// carry (`keep`). Both table formats usually print straight to a terminal,
/// and an escape sequence in a banner would be run there -- the attack
/// `sanitize_for_terminal` exists for.
pub(super) fn defuse_controls(text: &str, keep: &[char]) -> String {
    text.chars()
        .map(|c| {
            if c.is_control() && !keep.contains(&c) {
                '.'
            } else {
                c
            }
        })
        .collect()
}
