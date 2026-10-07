mod csv;
mod markdown;
mod rows;

use crate::args::ListOutput;
use anyhow::Result;
use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OutputFormat {
    Text,
    Json,
    Yaml,
    Csv,
    Markdown,
}

pub(crate) fn output_format(json: bool, yaml: bool) -> Result<OutputFormat> {
    list_output_format(ListOutput {
        json,
        yaml,
        csv: false,
        md: false,
    })
}

/// For the commands that return a list of rows, which also take `--csv` and
/// `--md`. Commands without that shape use [`output_format`] and never
/// declare those flags, so clap rejects them there before this runs.
pub(crate) fn list_output_format(flags: ListOutput) -> Result<OutputFormat> {
    let ListOutput {
        json,
        yaml,
        csv,
        md,
    } = flags;
    if [json, yaml, csv, md].into_iter().filter(|set| *set).count() > 1 {
        anyhow::bail!("Use only one of --json, --yaml, --csv or --md");
    }
    Ok(if yaml {
        OutputFormat::Yaml
    } else if json {
        OutputFormat::Json
    } else if csv {
        OutputFormat::Csv
    } else if md {
        OutputFormat::Markdown
    } else {
        OutputFormat::Text
    })
}

pub(crate) fn print_structured<T: Serialize + ?Sized>(
    format: OutputFormat,
    value: &T,
) -> Result<()> {
    let text = match format {
        OutputFormat::Json => serde_json::to_string_pretty(value)?,
        OutputFormat::Yaml => serde_yaml_ng::to_string(value)?,
        OutputFormat::Csv => csv::to_csv(value)?,
        OutputFormat::Markdown => markdown::to_markdown(value)?,
        OutputFormat::Text => return Ok(()),
    };
    // An empty CSV or Markdown table means nothing was found; print nothing
    // rather than a blank line.
    if !text.is_empty() {
        emit(&text)?;
    }
    Ok(())
}

/// Print one block of output, as `println!` does, except that a reader that
/// has gone away ends the output instead of panicking.
///
/// `netscli scan ... --json | head` closes the pipe after ten lines. That is
/// the reader saying it has seen enough, not a fault, and `println!` turned it
/// into a panic message and exit code 101. This stops quietly with 0, as other
/// command-line tools do. Any other write error is still an error.
///
/// Used where the output can be large. The few-line prints elsewhere fit in a
/// pipe's buffer, so a reader that leaves early never reaches them.
pub(crate) fn emit(text: &str) -> Result<()> {
    use std::io::{ErrorKind, Write};

    let mut stdout = std::io::stdout().lock();
    match writeln!(stdout, "{text}").and_then(|()| stdout.flush()) {
        Err(error) if error.kind() == ErrorKind::BrokenPipe => std::process::exit(0),
        other => Ok(other?),
    }
}

/// Refuse to write over a file that is already there, unless `force`.
///
/// For the one command that writes a file of its own choosing, `pcap`. Its
/// default name is the same every run, so a second capture replaced the first
/// without a word. The TUI's `/export` has always refused for the same reason.
/// Only the pcap build calls it.
#[cfg_attr(not(feature = "pcap"), allow(dead_code))]
pub(crate) fn ensure_not_overwritten(path: &std::path::Path, force: bool) -> Result<()> {
    if !force && path.exists() {
        anyhow::bail!(
            "{} already exists. Choose another --output, or pass --force to replace it.",
            path.display()
        );
    }
    Ok(())
}

/// The CSV a result would print, for tests elsewhere in the crate.
#[cfg(test)]
pub(crate) fn csv_for_test<T: Serialize + ?Sized>(value: &T) -> String {
    csv::to_csv(value).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(json: bool, yaml: bool, csv: bool, md: bool) -> ListOutput {
        ListOutput {
            json,
            yaml,
            csv,
            md,
        }
    }

    #[test]
    fn an_existing_capture_file_is_not_replaced_unless_forced() {
        let path =
            std::env::temp_dir().join(format!("netscli-capture-{}.pcap", std::process::id()));
        std::fs::write(&path, b"the first capture").unwrap();

        let err = ensure_not_overwritten(&path, false)
            .unwrap_err()
            .to_string();
        assert!(err.contains("already exists"), "{err}");
        assert!(err.contains("--force"), "{err}");
        assert!(ensure_not_overwritten(&path, true).is_ok());

        std::fs::remove_file(&path).unwrap();
        // A name nothing is using is fine either way.
        assert!(ensure_not_overwritten(&path, false).is_ok());
    }

    #[test]
    fn one_structured_format_at_a_time() {
        assert!(list_output_format(flags(true, false, true, false)).is_err());
        assert!(list_output_format(flags(false, true, true, false)).is_err());
        assert!(list_output_format(flags(false, false, true, true)).is_err());
        assert!(list_output_format(flags(true, true, false, false)).is_err());
        assert_eq!(
            list_output_format(flags(false, false, true, false)).unwrap(),
            OutputFormat::Csv
        );
        assert_eq!(
            list_output_format(flags(false, false, false, true)).unwrap(),
            OutputFormat::Markdown
        );
        assert_eq!(
            list_output_format(flags(false, false, false, false)).unwrap(),
            OutputFormat::Text
        );
    }
}
