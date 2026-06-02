use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::time::timeout;

mod http;
mod tls;

pub(super) use http::{first_banner_line, probe_http, read_banner};
pub(super) use tls::probe_tls;

const ENRICH_MAX_BYTES: usize = 4096;

fn probe_timeout(timeout_ms: u64) -> Duration {
    Duration::from_millis(timeout_ms.clamp(150, 1200))
}

async fn read_once<S>(stream: &mut S, timeout_ms: u64) -> Option<Vec<u8>>
where
    S: AsyncRead + Unpin,
{
    let mut buf = vec![0_u8; ENRICH_MAX_BYTES];
    let n = timeout(probe_timeout(timeout_ms), stream.read(&mut buf))
        .await
        .ok()?
        .ok()?;
    if n == 0 {
        return None;
    }
    buf.truncate(n);
    Some(buf)
}

async fn read_until<S, F>(stream: &mut S, timeout_ms: u64, done: F) -> Option<Vec<u8>>
where
    S: AsyncRead + Unpin,
    F: Fn(&[u8]) -> bool,
{
    let read = async {
        let mut out = Vec::with_capacity(512);
        let mut chunk = [0_u8; 512];
        loop {
            let n = stream.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            out.extend_from_slice(&chunk[..n]);
            if out.len() >= ENRICH_MAX_BYTES || done(&out) {
                break;
            }
        }
        Ok::<Vec<u8>, std::io::Error>(out)
    };

    let bytes = timeout(probe_timeout(timeout_ms), read).await.ok()?.ok()?;
    if bytes.is_empty() {
        None
    } else {
        Some(bytes)
    }
}

fn sanitize(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .map(|c| {
            if c.is_control() && c != '\n' && c != '\r' && c != '\t' {
                '.'
            } else {
                c
            }
        })
        .take(ENRICH_MAX_BYTES)
        .collect()
}
