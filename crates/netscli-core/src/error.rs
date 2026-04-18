//! Public error type for `netscli-core`.
//!
//! Library consumers can pattern-match on [`Error`] variants instead
//! of passing an opaque `anyhow::Error` around. The enum is marked
//! `#[non_exhaustive]` so new categories can be added without being
//! breaking changes — match arms should use a trailing `_ =>` fallback.
//!
//! All public functions in this crate return `Result<T, Error>`. A few
//! private implementation helpers (e.g. ping's ICMP round-trip inside
//! `PingScanner::ping`) still use `anyhow::Error` internally because
//! they never leak their error type to consumers, and the
//! [`From<anyhow::Error>`](Error) bridge would convert them to
//! `Error::Other` anyway.

use std::io;

use thiserror::Error;

/// Errors produced by `netscli-core` operations.
///
/// Variants group failures by category rather than by call site so
/// consumers can write one match arm per *kind* of problem (`Dns`,
/// `InvalidInput`, etc.) instead of per specific operation.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum Error {
    /// The caller supplied bad input (malformed IP, port 0, empty
    /// host, subnet too large, etc). Recoverable by the caller
    /// correcting the input.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// DNS resolution failed. Wraps the reason as a string because
    /// `hickory-resolver` errors aren't `Clone` and their variants
    /// aren't stable enough to re-export directly.
    #[error("DNS resolution failed: {0}")]
    Dns(String),

    /// A socket-level network operation failed (connection refused,
    /// unreachable, host down, etc).
    #[error("network error: {0}")]
    Network(String),

    /// An operation exceeded its configured timeout. The value is
    /// the timeout that was hit, in milliseconds.
    #[error("timed out after {0}ms")]
    Timeout(u64),

    /// The requested operation isn't available in this build (e.g.
    /// packet capture without the `pcap` feature) or on this platform.
    #[error("unsupported: {0}")]
    Unsupported(String),

    /// Standard I/O error (file open, file write, socket bind, etc).
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),

    /// SQLite / sqlx error. Only present with the `db` feature.
    #[cfg(feature = "db")]
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    /// libpcap / Npcap error. Only present with the `pcap` feature.
    #[cfg(feature = "pcap")]
    #[error("pcap error: {0}")]
    Pcap(#[from] ::pcap::Error),

    /// Fallback for errors that haven't been categorised yet.
    /// New variants will land here and move out as modules convert
    /// from `anyhow::Error` to this type.
    #[error("{0}")]
    Other(String),
}

/// `netscli-core`'s public result type. Aliased so callers can write
/// `netscli_core::Result<T>` without importing both.
pub type Result<T> = std::result::Result<T, Error>;

// Bridge from anyhow so modules that still use anyhow internally can
// `?` into this type. The anyhow::Error gets rendered via Display so
// we don't lose the message, just the opaque type.
impl From<anyhow::Error> for Error {
    fn from(err: anyhow::Error) -> Self {
        Error::Other(err.to_string())
    }
}

// Also allow our Error to be wrapped in anyhow where callers haven't
// been converted yet. Makes cross-conversion lossless in both directions.
impl Error {
    /// Convenience constructor for `Error::InvalidInput` that accepts
    /// anything `Display`able so call sites stay terse.
    pub fn invalid_input<T: std::fmt::Display>(msg: T) -> Self {
        Error::InvalidInput(msg.to_string())
    }

    /// Convenience constructor for `Error::Dns`.
    pub fn dns<T: std::fmt::Display>(msg: T) -> Self {
        Error::Dns(msg.to_string())
    }

    /// Convenience constructor for `Error::Network`.
    pub fn network<T: std::fmt::Display>(msg: T) -> Self {
        Error::Network(msg.to_string())
    }

    /// Convenience constructor for `Error::Unsupported`.
    pub fn unsupported<T: std::fmt::Display>(msg: T) -> Self {
        Error::Unsupported(msg.to_string())
    }
}
