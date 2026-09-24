mod csv;

use anyhow::Result;
use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OutputFormat {
    Text,
    Json,
    Yaml,
    Csv,
}

pub(crate) fn output_format(json: bool, yaml: bool) -> Result<OutputFormat> {
    output_format_with_csv(json, yaml, false)
}

/// For the commands that also take `--csv`: those whose result is a list of
/// rows. Commands without that shape never declare the flag, so clap rejects
/// `--csv` on them before this runs.
pub(crate) fn output_format_with_csv(json: bool, yaml: bool, csv: bool) -> Result<OutputFormat> {
    if [json, yaml, csv].into_iter().filter(|set| *set).count() > 1 {
        anyhow::bail!("Use only one of --json, --yaml or --csv");
    }
    if yaml {
        Ok(OutputFormat::Yaml)
    } else if json {
        Ok(OutputFormat::Json)
    } else if csv {
        Ok(OutputFormat::Csv)
    } else {
        Ok(OutputFormat::Text)
    }
}

pub(crate) fn print_structured<T: Serialize + ?Sized>(
    format: OutputFormat,
    value: &T,
) -> Result<()> {
    match format {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(value)?),
        OutputFormat::Yaml => println!("{}", serde_yaml_ng::to_string(value)?),
        OutputFormat::Csv => {
            let csv = csv::to_csv(value)?;
            if !csv.is_empty() {
                println!("{csv}");
            }
        }
        OutputFormat::Text => {}
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

    #[test]
    fn one_structured_format_at_a_time() {
        assert!(output_format_with_csv(true, false, true).is_err());
        assert!(output_format_with_csv(false, true, true).is_err());
        assert!(output_format_with_csv(true, true, false).is_err());
        assert_eq!(
            output_format_with_csv(false, false, true).unwrap(),
            OutputFormat::Csv
        );
        assert_eq!(
            output_format_with_csv(false, false, false).unwrap(),
            OutputFormat::Text
        );
    }
}
