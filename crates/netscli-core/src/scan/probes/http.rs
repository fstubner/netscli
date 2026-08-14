use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::time::timeout;

use super::{probe_timeout, read_once, read_until, sanitize, single_line_display};
use crate::scan::types::{HttpHeader, HttpProbe};

const HTTP_METHOD: &[u8] = b"HEAD / HTTP/1.1";
const USER_AGENT: &str = "netscli-scan";

pub(in crate::scan) async fn probe_http<S>(
    stream: &mut S,
    host: &str,
    timeout_ms: u64,
) -> Option<(HttpProbe, Option<String>, Option<String>)>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let req = format!(
        "{}\r\nHost: {}\r\nUser-Agent: {}\r\nConnection: close\r\n\r\n",
        String::from_utf8_lossy(HTTP_METHOD),
        host,
        USER_AGENT
    );

    timeout(probe_timeout(timeout_ms), stream.write_all(req.as_bytes()))
        .await
        .ok()?
        .ok()?;

    let raw = read_until_headers(stream, timeout_ms).await?;
    let http = parse_http(&raw)?;
    let banner = http_banner(&http);
    Some((http, banner, Some(raw)))
}

pub(in crate::scan) async fn read_banner<S>(stream: &mut S, timeout_ms: u64) -> Option<String>
where
    S: AsyncRead + Unpin,
{
    read_once(stream, timeout_ms)
        .await
        .map(|bytes| sanitize(&bytes))
}

async fn read_until_headers<S>(stream: &mut S, timeout_ms: u64) -> Option<String>
where
    S: AsyncRead + Unpin,
{
    read_until(stream, timeout_ms, |buf| {
        buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.windows(2).any(|w| w == b"\n\n")
    })
    .await
    .map(|bytes| sanitize(&bytes))
}

fn parse_http(raw: &str) -> Option<HttpProbe> {
    let normalized = raw.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    let status_line = lines.next()?.trim().to_string();
    if !status_line.starts_with("HTTP/") {
        return None;
    }

    let headers = lines
        .take_while(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some(HttpHeader {
                name: name.trim().to_string(),
                value: value.trim().to_string(),
            })
        })
        .take(32)
        .collect();

    Some(HttpProbe {
        status_line: Some(status_line),
        headers,
    })
}

fn http_banner(http: &HttpProbe) -> Option<String> {
    http.headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case("server"))
        .map(|h| h.value.clone())
        .or_else(|| http.status_line.clone())
        // Server header values and status lines are attacker-chosen and
        // get printed as a single table cell.
        .map(|value| single_line_display(&value))
}

pub(in crate::scan) fn first_banner_line(raw: &str) -> String {
    // `.trim()` only removes a *trailing* \r; an interior one survives
    // and would let the remote host overwrite its own output row.
    single_line_display(raw.lines().next().unwrap_or(raw).trim())
        .chars()
        .take(160)
        .collect()
}
