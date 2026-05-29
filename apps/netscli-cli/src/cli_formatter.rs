//! Plain-text (ANSI-colored) CLI output formatter.
//!
//! All formatter methods stay on `CliFormatter` for callers, while command
//! families live in focused modules under `cli_formatter/`.

mod discover;
mod inspect;
#[cfg(feature = "pcap")]
mod pcap;
mod scan;
mod style;
mod sweep;
mod table;

#[cfg(test)]
mod tests;

pub struct CliFormatter;
