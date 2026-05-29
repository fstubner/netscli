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

#[cfg(feature = "pcap")]
async fn check_pcap() -> DependencyStatus {
    let result = tokio::task::spawn_blocking(PcapEngine::check_support).await;
    match result {
        Ok(Ok(devs)) => DependencyStatus {
            name: "libpcap".to_string(),
            installed: true,
            details: Some(format!("interfaces: {}", devs.join(", "))),
        },
        Ok(Err(e)) => DependencyStatus {
            name: "libpcap".to_string(),
            installed: false,
            details: Some(e.to_string()),
        },
        Err(e) => DependencyStatus {
            name: "libpcap".to_string(),
            installed: false,
            details: Some(e.to_string()),
        },
    }
}

#[cfg(not(feature = "pcap"))]
async fn check_pcap() -> DependencyStatus {
    DependencyStatus {
        name: "libpcap".to_string(),
        installed: true,
        details: Some(
            "pcap support disabled at compile time (build with --features pcap to enable)"
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
            details: None,
        });
    }

    deps
}
