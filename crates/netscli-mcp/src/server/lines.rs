//! Reading one bounded line from the transport.
//!
//! Split out of `server.rs` when the read loop's fix for saturation pushed
//! that file past the size guard. Framing is a seam of its own: nothing here
//! knows about JSON-RPC, only about where one message ends.

use tokio::io::{AsyncBufRead, AsyncBufReadExt};

/// Longest line accepted on stdin.
///
/// `next_line` grows a `String` without limit, so a client that sends
/// megabytes and no newline was an unbounded allocation.
pub(super) const MAX_REQUEST_LINE_BYTES: usize = 4 * 1024 * 1024;

/// Why a line could not be read.
pub(super) enum LineError {
    /// The bytes were not a usable line, but the transport is still fine.
    Invalid(&'static str),
    /// The transport itself failed.
    Fatal(std::io::Error),
}

/// Read one line, bounded, treating undecodable bytes as a bad message
/// rather than the end of the server.
pub(super) async fn read_bounded_line<R>(
    reader: &mut R,
    out: &mut String,
) -> Result<usize, LineError>
where
    R: AsyncBufRead + Unpin,
{
    let mut raw = Vec::new();
    // One byte past the limit, so an over-long line is detected rather than
    // silently truncated into something that might still parse as JSON.
    let mut limited =
        tokio::io::AsyncReadExt::take(&mut *reader, MAX_REQUEST_LINE_BYTES as u64 + 1);
    let read = limited
        .read_until(b'\n', &mut raw)
        .await
        .map_err(LineError::Fatal)?;
    if read == 0 {
        return Ok(0);
    }
    if raw.len() > MAX_REQUEST_LINE_BYTES {
        // The rest of the line is still waiting to be read. Left there, it
        // was taken for the next message: another parse error at best, and a
        // request placed after 4 MiB of padding was run.
        if raw.last() != Some(&b'\n') {
            skip_past_newline(reader).await.map_err(LineError::Fatal)?;
        }
        return Err(LineError::Invalid("line exceeds the maximum request size"));
    }
    match String::from_utf8(raw) {
        Ok(text) => {
            out.push_str(&text);
            Ok(read)
        }
        Err(_) => Err(LineError::Invalid("line is not valid UTF-8")),
    }
}

/// Discard input up to and including the next newline, or to EOF, without
/// holding any of it.
async fn skip_past_newline<R>(reader: &mut R) -> std::io::Result<()>
where
    R: AsyncBufRead + Unpin,
{
    loop {
        let buf = reader.fill_buf().await?;
        if buf.is_empty() {
            return Ok(());
        }
        match buf.iter().position(|&b| b == b'\n') {
            Some(at) => {
                reader.consume(at + 1);
                return Ok(());
            }
            None => {
                let len = buf.len();
                reader.consume(len);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_rest_of_an_over_long_line_is_not_read_as_the_next_message() {
        let mut input = "x".repeat(MAX_REQUEST_LINE_BYTES + 100).into_bytes();
        input.extend_from_slice(b"\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n");
        let mut reader = input.as_slice();

        let mut line = String::new();
        assert!(matches!(
            read_bounded_line(&mut reader, &mut line).await,
            Err(LineError::Invalid(_))
        ));

        let mut line = String::new();
        assert!(read_bounded_line(&mut reader, &mut line).await.is_ok());
        assert_eq!(
            line.trim_end(),
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#
        );
    }
}
