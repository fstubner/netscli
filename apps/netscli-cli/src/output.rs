use anyhow::Result;
use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OutputFormat {
    Text,
    Json,
    Yaml,
}

pub(crate) fn output_format(json: bool, yaml: bool) -> Result<OutputFormat> {
    if json && yaml {
        anyhow::bail!("Use only one of --json or --yaml");
    }
    if yaml {
        Ok(OutputFormat::Yaml)
    } else if json {
        Ok(OutputFormat::Json)
    } else {
        Ok(OutputFormat::Text)
    }
}

pub(crate) fn print_structured<T: Serialize>(format: OutputFormat, value: &T) -> Result<()> {
    match format {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(value)?),
        OutputFormat::Yaml => println!("{}", serde_yaml_ng::to_string(value)?),
        OutputFormat::Text => {}
    }
    Ok(())
}
