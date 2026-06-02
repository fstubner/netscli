use std::net::IpAddr;
use std::sync::Arc;

use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::rustls::{
    self,
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    crypto::{ring, verify_tls12_signature, verify_tls13_signature, CryptoProvider},
    pki_types::{CertificateDer, ServerName, UnixTime},
    DigitallySignedStruct, SignatureScheme,
};
use tokio_rustls::TlsConnector;

use super::http::probe_http;
use super::probe_timeout;
use crate::scan::services::is_https_port;
use crate::scan::types::{HttpProbe, TlsProbe};

#[derive(Debug)]
struct ProbeVerifier(CryptoProvider);

impl ServerCertVerifier for ProbeVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

pub(in crate::scan) async fn probe_tls(
    target: IpAddr,
    port: u16,
    stream: TcpStream,
    timeout_ms: u64,
    service: Option<&str>,
) -> Option<(TlsProbe, Option<HttpProbe>, Option<String>, Option<String>)> {
    let provider = ring::default_provider();
    let verifier = Arc::new(ProbeVerifier(provider.clone()));
    let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(provider))
        .with_safe_default_protocol_versions()
        .ok()?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];

    let connector = TlsConnector::from(Arc::new(config));
    let server_name = ServerName::try_from(target.to_string())
        .or_else(|_| ServerName::try_from("localhost".to_string()))
        .ok()?;
    let mut tls_stream = timeout(
        probe_timeout(timeout_ms),
        connector.connect(server_name, stream),
    )
    .await
    .ok()?
    .ok()?;

    let (_, conn) = tls_stream.get_ref();
    let alpn = conn
        .alpn_protocol()
        .map(|v| String::from_utf8_lossy(v).to_string());
    let protocol = conn.protocol_version().map(|v| format!("{v:?}"));
    let cipher_suite = conn
        .negotiated_cipher_suite()
        .map(|suite| format!("{:?}", suite.suite()));

    let tls = TlsProbe {
        protocol,
        cipher_suite,
        alpn: alpn.clone(),
    };

    if is_https_port(port, service) && alpn.as_deref() != Some("h2") {
        if let Some((http, mut banner, raw)) =
            probe_http(&mut tls_stream, &target.to_string(), timeout_ms).await
        {
            if let Some(proto) = tls.protocol.as_deref() {
                banner = match banner {
                    Some(b) => Some(format!("{b} - {proto}")),
                    None => Some(proto.to_string()),
                };
            }
            return Some((tls, Some(http), banner, raw));
        }
    }

    let banner = tls.protocol.clone();
    Some((tls, None, banner, None))
}
