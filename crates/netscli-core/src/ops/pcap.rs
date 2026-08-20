use super::config::Ops;
use crate::error::{Error, Result};
use crate::{
    PcapCancelToken, PcapConfig, PcapEngine, PcapParseResult, PcapResult,
    DEFAULT_PCAP_CAPTURE_SECONDS, MAX_PCAP_CAPTURE_PACKETS, MAX_PCAP_CAPTURE_SECONDS,
};
use std::path::PathBuf;

impl Ops {
    pub fn pcap_check_support(&self) -> Result<Vec<String>> {
        PcapEngine::check_support()
    }

    pub fn capture_pcap(
        &self,
        interface: String,
        filter: Option<String>,
        duration: Option<u64>,
        output_file: Option<String>,
        max_packets: Option<usize>,
    ) -> Result<PcapResult> {
        let (duration, max_packets) = normalize_capture_limits(duration, max_packets)?;
        let cfg = PcapConfig {
            interface,
            filter,
            output_file: normalize_capture_output(output_file)?,
            duration,
            max_packets,
        };
        PcapEngine::capture(cfg)
    }

    pub fn parse_pcap_file(
        &self,
        input_file: String,
        max_packets: Option<usize>,
    ) -> Result<PcapParseResult> {
        PcapEngine::parse_file(input_file.into(), max_packets)
    }

    /// Async-friendly PCAP capture wrapper.
    ///
    /// PCAP capture is inherently blocking (libpcap read loop + file I/O). This
    /// runs it in a dedicated blocking thread so async runtimes (CLI/Tauri/MCP)
    /// remain responsive.
    pub async fn capture_pcap_async(
        &self,
        interface: String,
        filter: Option<String>,
        duration: Option<u64>,
        output_file: Option<String>,
        max_packets: Option<usize>,
    ) -> Result<PcapResult> {
        self.capture_pcap_async_with_cancel(
            interface,
            filter,
            duration,
            output_file,
            max_packets,
            None,
        )
        .await
    }

    pub async fn capture_pcap_async_with_cancel(
        &self,
        interface: String,
        filter: Option<String>,
        duration: Option<u64>,
        output_file: Option<String>,
        max_packets: Option<usize>,
        cancel: Option<PcapCancelToken>,
    ) -> Result<PcapResult> {
        let (duration, max_packets) = normalize_capture_limits(duration, max_packets)?;
        let cfg = PcapConfig {
            interface,
            filter,
            output_file: normalize_capture_output(output_file)?,
            duration,
            max_packets,
        };

        let task =
            tokio::task::spawn_blocking(move || PcapEngine::capture_with_cancel(cfg, cancel));
        match task.await {
            Ok(res) => Ok(res?),
            Err(e) => Err(Error::Other(format!("pcap capture task failed: {e}"))),
        }
    }
}

fn normalize_capture_limits(
    duration: Option<u64>,
    max_packets: Option<usize>,
) -> Result<(Option<std::time::Duration>, Option<usize>)> {
    let max_packets = match max_packets {
        Some(0) => return Err(Error::invalid_input("max packets must be greater than 0")),
        Some(n) if n > MAX_PCAP_CAPTURE_PACKETS => {
            return Err(Error::invalid_input(format!(
                "max packets too large: {n} (max {MAX_PCAP_CAPTURE_PACKETS})"
            )));
        }
        Some(n) => Some(n),
        None => None,
    };

    let duration = match duration {
        Some(0) => return Err(Error::invalid_input("duration must be greater than 0")),
        Some(seconds) if seconds > MAX_PCAP_CAPTURE_SECONDS => {
            return Err(Error::invalid_input(format!(
                "duration too long: {seconds}s (max {MAX_PCAP_CAPTURE_SECONDS}s)"
            )));
        }
        Some(seconds) => Some(std::time::Duration::from_secs(seconds)),
        None if max_packets.is_none() => {
            Some(std::time::Duration::from_secs(DEFAULT_PCAP_CAPTURE_SECONDS))
        }
        // A packet count with no duration used to mean "no time limit at
        // all", so a capture waiting for packets that never arrive on a quiet
        // interface ran until something else stopped it -- past the very
        // ceiling this function enforces when a duration *is* given. The cap
        // is the cap either way.
        None => Some(std::time::Duration::from_secs(MAX_PCAP_CAPTURE_SECONDS)),
    };

    Ok((duration, max_packets))
}

fn normalize_capture_output(output_file: Option<String>) -> Result<PathBuf> {
    let path = PathBuf::from(output_file.unwrap_or_else(|| "capture.pcap".to_string()));
    let is_pcap = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pcap"));
    if !is_pcap {
        return Err(Error::invalid_input("pcap output file must end in .pcap"));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_limits_default_to_bounded_duration() {
        let (duration, max_packets) = normalize_capture_limits(None, None).unwrap();
        assert_eq!(
            duration,
            Some(std::time::Duration::from_secs(DEFAULT_PCAP_CAPTURE_SECONDS))
        );
        assert_eq!(max_packets, None);
    }

    #[test]
    fn capture_limits_reject_zero_and_too_large_values() {
        assert!(normalize_capture_limits(Some(0), None).is_err());
        assert!(normalize_capture_limits(None, Some(0)).is_err());
        assert!(normalize_capture_limits(Some(MAX_PCAP_CAPTURE_SECONDS + 1), None).is_err());
        assert!(normalize_capture_limits(None, Some(MAX_PCAP_CAPTURE_PACKETS + 1)).is_err());
    }

    #[test]
    fn capture_output_requires_pcap_extension() {
        assert!(normalize_capture_output(Some("capture.pcap".to_string())).is_ok());
        assert!(normalize_capture_output(Some("capture.txt".to_string())).is_err());
    }
}
