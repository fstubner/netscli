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
        println!("{text}");
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
