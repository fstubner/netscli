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

/// Strip dangerous control characters from bytes read off a scanned host.
///
/// Everything here is chosen by the remote end. `ESC` and friends are
/// replaced so they can never drive the operator's terminal.
///
/// `\n`, `\r` and `\t` are deliberately preserved: this feeds
/// `parse_http`, which splits an HTTP response on `\r\n`, so mangling
/// them here would break header parsing. Line structure is stripped
/// later, by [`single_line_display`], at the point a value becomes a
/// one-line banner.
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

/// Collapse a remote-supplied value into one terminal-safe display line.
///
/// `sanitize` keeps `\n`/`\r`/`\t` so the HTTP parser can do its job, but
/// a banner is printed as a single table cell. A surviving lone `\r`
/// there lets a scanned host carriage-return over the row it was printed
/// on and forge the output above it, and `\n` fabricates extra rows.
pub(in crate::scan) fn single_line_display(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_control() { '.' } else { c })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{sanitize, single_line_display};

    #[test]
    fn sanitize_strips_escape_sequences() {
        let out = sanitize(b"SSH-2.0\x1b[31mspoofed");
        assert!(!out.contains('\u{1b}'), "ESC survived: {out:?}");
        assert_eq!(out, "SSH-2.0.[31mspoofed");
    }

    #[test]
    fn sanitize_preserves_line_structure_for_the_http_parser() {
        // parse_http splits on \r\n; mangling these would break it.
        assert_eq!(
            sanitize(b"HTTP/1.1 200 OK\r\nServer:\tnginx"),
            "HTTP/1.1 200 OK\r\nServer:\tnginx"
        );
    }

    #[test]
    fn single_line_display_strips_interior_carriage_return() {
        // A banner of "real\rfake" would print "fake" over "real".
        assert_eq!(single_line_display("real\rfake"), "real.fake");
    }

    #[test]
    fn single_line_display_strips_newlines_and_escapes() {
        assert_eq!(single_line_display("a\nb"), "a.b");
        assert_eq!(single_line_display("a\u{1b}[2Jb"), "a.[2Jb");
    }
}
