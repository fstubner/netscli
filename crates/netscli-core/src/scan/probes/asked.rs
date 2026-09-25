//! Reading a greeting as bytes, and asking a quiet service one read-only
//! question.
//!
//! Most services that name themselves do it unprompted (SSH, FTP, mail).
//! MySQL does too, but in a binary packet that the text banner path would
//! mangle, so its greeting is read as bytes. Redis and Memcached say nothing
//! until asked; each gets the one question that returns its version and
//! changes nothing: `INFO server` and `version`.

use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::time::timeout;

use super::{probe_timeout, read_once, sanitize};

/// A service that answers a read-only question with its version.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::scan) enum Quiet {
    Redis,
    Memcached,
}

impl Quiet {
    /// The service on `port`, if it's one that waits to be asked.
    pub(in crate::scan) fn on(port: u16, service: Option<&str>) -> Option<Self> {
        match (port, service) {
            (6379, _) | (_, Some("redis")) => Some(Self::Redis),
            (11211, _) | (_, Some("memcached")) => Some(Self::Memcached),
            _ => None,
        }
    }

    fn question(self) -> &'static [u8] {
        match self {
            Self::Redis => b"INFO server\r\n",
            Self::Memcached => b"version\r\n",
        }
    }
}

/// The first bytes a service sends after connect, unmodified.
pub(in crate::scan) async fn read_greeting<S>(stream: &mut S, timeout_ms: u64) -> Option<Vec<u8>>
where
    S: AsyncRead + Unpin,
{
    read_once(stream, timeout_ms).await
}

/// Ask `service` its question and return the reply.
pub(in crate::scan) async fn ask<S>(
    stream: &mut S,
    service: Quiet,
    timeout_ms: u64,
) -> Option<Vec<u8>>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    timeout(
        probe_timeout(timeout_ms),
        stream.write_all(service.question()),
    )
    .await
    .ok()?
    .ok()?;
    read_once(stream, timeout_ms).await
}

/// Bytes off the wire as the text the rest of the scan stores.
pub(in crate::scan) fn as_text(bytes: &[u8]) -> String {
    sanitize(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_redis_and_memcached_are_asked_anything() {
        assert_eq!(Quiet::on(6379, None), Some(Quiet::Redis));
        assert_eq!(Quiet::on(7000, Some("redis")), Some(Quiet::Redis));
        assert_eq!(Quiet::on(11211, None), Some(Quiet::Memcached));
        assert_eq!(Quiet::on(22, Some("ssh")), None);
        assert_eq!(Quiet::Redis.question(), b"INFO server\r\n");
    }
}
