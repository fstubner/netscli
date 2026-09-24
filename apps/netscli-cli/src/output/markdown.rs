//! `--md`: the rows from [`super::rows`] as a Markdown table, for pasting a
//! result into a GitHub issue, a pull request or a wiki page.
//!
//! GitHub-flavoured table syntax, which is what those places render. Same
//! columns and cells as `--csv`; only the quoting differs.

use super::rows::{defuse_controls, header, rows_of, Row};
use anyhow::Result;
use serde::Serialize;

/// Render a result as a Markdown table. An empty list renders as an empty
/// string, as it does for CSV.
pub(crate) fn to_markdown<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    Ok(render(&rows_of(value)?))
}

fn render(rows: &[Row]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let header = header(rows);
    let line = |cells: Vec<String>| format!("| {} |", cells.join(" | "));
    let mut lines = Vec::with_capacity(rows.len() + 2);
    // Column names are this crate's own field names, plain identifiers, so
    // they go in unescaped: `record_type` rather than an escaped underscore,
    // in a table someone may read raw in a terminal before pasting it.
    lines.push(line(header.clone()));
    lines.push(line(header.iter().map(|_| "---".to_string()).collect()));
    for row in rows {
        lines.push(line(
            header.iter().map(|name| escape(&row.cell(name))).collect(),
        ));
    }
    lines.join("\n")
}

/// Make a cell safe to put in a table row.
///
/// The text is often a banner or name a scanned host chose, and it lands in
/// something that renders Markdown and HTML. So every ASCII punctuation
/// character that means something in Markdown -- `|` above all, which would
/// split the cell -- is backslash-escaped, which CommonMark defines for any
/// ASCII punctuation and which renders as the character itself. `<` and `>`
/// are among them, so a host cannot inject HTML. A table row is one line:
/// line breaks become `<br>`, added after escaping so it is the only tag, and
/// tabs become spaces. Other control characters become `.`, as in CSV.
fn escape(cell: &str) -> String {
    let cleaned = defuse_controls(cell, &['\t', '\r', '\n']);
    let mut out = String::with_capacity(cleaned.len());
    let mut chars = cleaned.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push_str("<br>");
            }
            '\n' => out.push_str("<br>"),
            '\t' => out.push(' '),
            '\\' | '|' | '`' | '*' | '_' | '[' | ']' | '<' | '>' | '&' | '#' | '~' | '!' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize)]
    struct Record {
        record_type: &'static str,
        value: &'static str,
        ttl_seconds: u32,
    }

    #[test]
    fn a_result_is_a_table_with_the_json_names_as_headers() {
        let md = to_markdown(&[
            Record {
                record_type: "A",
                value: "172.67.141.41",
                ttl_seconds: 300,
            },
            Record {
                record_type: "AAAA",
                value: "2606:4700:3036::ac43:8d29",
                ttl_seconds: 300,
            },
        ])
        .unwrap();
        assert_eq!(
            md,
            "| record_type | value | ttl_seconds |\n\
             | --- | --- | --- |\n\
             | A | 172.67.141.41 | 300 |\n\
             | AAAA | 2606:4700:3036::ac43:8d29 | 300 |"
        );
    }

    #[test]
    fn nothing_found_prints_nothing() {
        let empty: Vec<Record> = Vec::new();
        assert_eq!(to_markdown(&empty).unwrap(), "");
    }

    #[test]
    fn a_pipe_in_a_banner_cannot_split_the_cell() {
        assert_eq!(escape("ssh | evil"), "ssh \\| evil");
    }

    #[test]
    fn a_host_cannot_inject_html_or_markdown() {
        assert_eq!(
            escape("<img src=x onerror=alert(1)>"),
            "\\<img src=x onerror=alert(1)\\>"
        );
        assert_eq!(escape("[click](http://x)"), "\\[click\\](http://x)");
        assert_eq!(escape("**bold**"), "\\*\\*bold\\*\\*");
    }

    #[test]
    fn a_multi_line_banner_stays_on_one_row() {
        assert_eq!(
            escape("HTTP/1.1 200 OK\r\nServer: x\n"),
            "HTTP/1.1 200 OK<br>Server: x<br>"
        );
    }

    #[test]
    fn a_host_cannot_send_escape_sequences_to_the_terminal() {
        assert_eq!(escape("\u{1b}[31mred"), ".\\[31mred");
    }
}
