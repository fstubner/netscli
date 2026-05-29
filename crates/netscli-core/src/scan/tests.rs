use std::io::ErrorKind;
use std::net::IpAddr;
use std::sync::Arc;

use rcgen::CertifiedKey;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::rustls::crypto::ring;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use tokio_rustls::{rustls, TlsAcceptor};

use super::probes::{probe_http, probe_tls};
use super::services::classify_connect_error;
use super::{PortScanner, PortStatus};

#[test]
fn test_guess_service() {
    assert_eq!(PortScanner::guess_service(22), Some("ssh".to_string()));
    assert_eq!(PortScanner::guess_service(80), Some("http".to_string()));
    assert_eq!(PortScanner::guess_service(443), Some("https".to_string()));
    assert_eq!(PortScanner::guess_service(9999), None);
}

#[test]
fn test_port_scanner_creation() {
    let scanner = PortScanner::new(256);
    assert_eq!(scanner.concurrency, 256);
}

#[test]
fn test_timeout_error_classifies_as_filtered() {
    assert_eq!(
        classify_connect_error(ErrorKind::TimedOut),
        PortStatus::Filtered
    );
    assert_eq!(
        classify_connect_error(ErrorKind::ConnectionRefused),
        PortStatus::Closed
    );
}

#[tokio::test]
async fn test_scan_localhost_common_ports() {
    let scanner = PortScanner::new(10);
    let localhost: IpAddr = "127.0.0.1".parse().unwrap();
    let ports = vec![22, 80, 443, 8080];

    let results = scanner.scan_host(localhost, ports.clone(), 1000).await;

    assert_eq!(results.len(), ports.len());
    for result in results {
        assert!(ports.contains(&result.port));
        assert_eq!(result.open, matches!(result.status, PortStatus::Open));
        if result.service.is_some() {
            match result.port {
                22 => assert_eq!(result.service, Some("ssh".to_string())),
                80 => assert_eq!(result.service, Some("http".to_string())),
                443 => assert_eq!(result.service, Some("https".to_string())),
                8080 => assert_eq!(result.service, Some("http-alt".to_string())),
                _ => {}
            }
        }
    }
}

#[tokio::test]
async fn test_scan_open_localhost_port_returns_open_with_banner() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        socket.write_all(b"SSH-2.0-netscli-test\r\n").await.unwrap();
    });

    let scanner = PortScanner::new(4);
    let mut results = scanner
        .scan_host(IpAddr::from([127, 0, 0, 1]), vec![port], 1000)
        .await;

    assert_eq!(results.len(), 1);
    let result = results.remove(0);
    assert!(result.open);
    assert_eq!(result.status, PortStatus::Open);
    assert!(result.latency_ms.is_some());
    assert_eq!(result.banner.as_deref(), Some("SSH-2.0-netscli-test"));
    assert!(result
        .raw
        .as_deref()
        .unwrap_or_default()
        .contains("SSH-2.0"));
}

#[tokio::test]
async fn test_scan_closed_local_port_records_latency() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let scanner = PortScanner::new(4);
    let mut results = scanner
        .scan_host(IpAddr::from([127, 0, 0, 1]), vec![port], 1000)
        .await;

    assert_eq!(results.len(), 1);
    let result = results.remove(0);
    assert!(!result.open);
    assert!(matches!(
        result.status,
        PortStatus::Closed | PortStatus::Filtered | PortStatus::Error
    ));
    if matches!(result.status, PortStatus::Closed) {
        assert!(result.latency_ms.is_some());
    }
}

#[tokio::test]
async fn test_http_probe_captures_banner_and_headers() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0_u8; 512];
        let _ = socket.read(&mut buf).await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nServer: netscli-test\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
    });

    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let (http, banner, raw) = probe_http(&mut stream, "127.0.0.1", 1000)
        .await
        .expect("HTTP metadata should be captured");

    assert_eq!(banner.as_deref(), Some("netscli-test"));
    assert_eq!(http.status_line.as_deref(), Some("HTTP/1.1 200 OK"));
    assert!(http
        .headers
        .iter()
        .any(|h| h.name == "Server" && h.value == "netscli-test"));
    assert!(raw.as_deref().unwrap_or_default().contains("HTTP/1.1"));
}

#[tokio::test]
async fn test_scan_captures_tls_metadata() {
    let CertifiedKey { cert, signing_key } =
        rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
    let cert_chain = vec![CertificateDer::from(cert.der().to_vec())];
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(signing_key.serialize_der()));
    let mut config =
        rustls::ServerConfig::builder_with_provider(Arc::new(ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(cert_chain, key)
            .unwrap();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];

    let acceptor = TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut stream = acceptor.accept(socket).await.unwrap();
        let mut buf = [0_u8; 512];
        let _ = stream.read(&mut buf).await;
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nServer: netscli-tls-test\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
    });

    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let (tls, http, banner, _raw) = probe_tls(
        IpAddr::from([127, 0, 0, 1]),
        port,
        stream,
        1000,
        Some("https"),
    )
    .await
    .expect("TLS metadata should be captured");

    assert!(tls.protocol.is_some());
    assert!(tls.cipher_suite.is_some());
    assert_eq!(tls.alpn.as_deref(), Some("http/1.1"));
    assert!(banner
        .as_deref()
        .unwrap_or_default()
        .contains("netscli-tls-test"));
    assert!(http.is_some());
}
