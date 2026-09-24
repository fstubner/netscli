//! `--csv`: the rows from [`super::rows`], quoted for a spreadsheet.
//!
//! JSON is still the lossless format. CSV has no escape for a control
//! character, so the ones that can hurt are replaced; see [`escape`].

use super::rows::{defuse_controls, header, rows_of, Row};
use anyhow::Result;
use serde::Serialize;

/// Render a result as CSV. An empty list renders as an empty string -- there
/// is no row to take the column names from.
pub(crate) fn to_csv<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    Ok(render(&rows_of(value)?))
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
        let cells = header.iter().map(|name| escape(&row.cell(name)));
        lines.push(cells.collect::<Vec<_>>().join(","));
    }
    lines.join("\n")
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
/// Control characters become `.`, as they do in text output, except tab, CR
/// and LF, which CSV carries inside a quoted cell and a multi-line banner
/// needs.
fn escape(cell: &str) -> String {
    let cleaned = defuse_controls(cell, &['\t', '\r', '\n']);
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
