use super::state::DependencyStatus;
#[cfg(feature = "pcap")]
use netscli_core::PcapEngine;
#[cfg(feature = "pcap")]
use std::time::Duration;
#[cfg(feature = "pcap")]
use tokio::process::Command;
#[cfg(feature = "pcap")]
use tokio::time::timeout;

#[cfg(feature = "pcap")]
const WHICH_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(feature = "pcap")]
async fn has_command(cmd: &str) -> bool {
    let program = if cfg!(windows) { "where" } else { "which" };
    let mut child = match Command::new(program)
        .arg(cmd)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    match timeout(WHICH_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => status.success(),
        _ => {
            let _ = child.kill().await;
            false
        }
    }
}

/// libpcap is what a build with packet capture cannot capture without, so it
/// is the one dependency `doctor` treats as required.
#[cfg(feature = "pcap")]
async fn check_pcap() -> DependencyStatus {
    let result = tokio::task::spawn_blocking(PcapEngine::check_support).await;
    match result {
        Ok(Ok(devs)) => DependencyStatus {
            name: "libpcap".to_string(),
            installed: true,
            required: true,
            details: Some(format!("interfaces: {}", devs.join(", "))),
        },
        Ok(Err(e)) => DependencyStatus {
            name: "libpcap".to_string(),
            installed: false,
            required: true,
            details: Some(e.to_string()),
        },
        Err(e) => DependencyStatus {
            name: "libpcap".to_string(),
            installed: false,
            required: true,
            details: Some(e.to_string()),
        },
    }
}

/// A build without capture is not broken, so nothing here is required. It is
/// not "installed" either: `doctor` is how people find out whether their build
/// can capture, and a tick would say it can.
#[cfg(not(feature = "pcap"))]
async fn check_pcap() -> DependencyStatus {
    DependencyStatus {
        name: "libpcap".to_string(),
        installed: false,
        required: false,
        details: Some(
            "packet capture is not compiled into this build (use a -pcap download, or build with --features pcap)"
                .to_string(),
        ),
    }
}

pub(super) async fn collect_status() -> Vec<DependencyStatus> {
    let mut deps = Vec::new();
    deps.push(check_pcap().await);
    #[cfg(feature = "pcap")]
    {
        let tcpdump = has_command("tcpdump").await;
        deps.push(DependencyStatus {
            name: "tcpdump".to_string(),
            installed: tcpdump,
            required: false,
            details: None,
        });
    }

    deps
}

#[cfg(all(test, not(feature = "pcap")))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_build_without_capture_does_not_report_libpcap_as_installed() {
        // `doctor` is how people learn what their build can do, and it used
        // to answer a standard build with a tick.
        let libpcap = check_pcap().await;
        assert!(!libpcap.installed);
        assert!(!libpcap.required, "a build without capture is not broken");
        assert!(libpcap.details.unwrap().contains("not compiled"));
    }
}
