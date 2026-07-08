use hickory_resolver::{
    config::{ResolverConfig, CLOUDFLARE},
    net::runtime::TokioRuntimeProvider,
    TokioResolver,
};
use std::sync::OnceLock;

use crate::error::{Error, Result};

const DNS_FALLBACK_ENV: &str = "NETSCLI_DNS_FALLBACK";

/// Shared resolver — parsing the system config (`/etc/resolv.conf` or the
/// Windows registry) on every lookup is wasteful for high-volume scans like
/// a /24 with reverse DNS enabled.
pub(super) fn shared_resolver() -> Result<&'static TokioResolver> {
    static RESOLVER: OnceLock<std::result::Result<TokioResolver, String>> = OnceLock::new();
    let cached = RESOLVER.get_or_init(|| {
        // hickory 0.26 replaced `TokioAsyncResolver::tokio_from_system_conf`
        // with a builder pattern. `builder_tokio()` reads `/etc/resolv.conf`
        // (or the Windows registry); `.build()` returns the resolver. Both
        // can fail, so we chain via `and_then`.
        TokioResolver::builder_tokio()
            .and_then(|b| b.build())
            .map_err(|e| e.to_string())
    });
    match cached {
        Ok(r) => Ok(r),
        Err(e) => Err(Error::dns(format!(
            "failed to load DNS resolver config: {e}"
        ))),
    }
}

/// Public fallback resolver used only after the system resolver returns an
/// error. Normal lookups should still respect the OS resolver first so local
/// split-DNS/VPN names keep working.
pub(super) fn fallback_resolver() -> Result<&'static TokioResolver> {
    static RESOLVER: OnceLock<std::result::Result<TokioResolver, String>> = OnceLock::new();
    let cached = RESOLVER.get_or_init(|| {
        TokioResolver::builder_with_config(
            ResolverConfig::udp_and_tcp(&CLOUDFLARE),
            TokioRuntimeProvider::default(),
        )
        .build()
        .map_err(|e| e.to_string())
    });

    match cached {
        Ok(r) => Ok(r),
        Err(e) => Err(Error::dns(format!(
            "failed to create DNS fallback resolver: {e}"
        ))),
    }
}

pub(super) fn should_use_public_fallback(host: &str) -> bool {
    if std::env::var(DNS_FALLBACK_ENV)
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "0" | "false" | "off" | "no"
            )
        })
        .unwrap_or(false)
    {
        return false;
    }

    !is_local_or_internal_name(host)
}

fn is_local_or_internal_name(host: &str) -> bool {
    let name = host.trim().trim_end_matches('.').to_ascii_lowercase();
    // Single-label names (no dot) are never public FQDNs — e.g. "nas" or
    // "printer" resolved via mDNS/NetBIOS/local search domains — so treat
    // them as local rather than leaking them to the public fallback.
    !name.contains('.')
        || name == "localhost"
        || name.ends_with(".localhost")
        || name.ends_with(".local")
        || name.ends_with(".lan")
        || name.ends_with(".home")
        || name.ends_with(".home.arpa")
        || name.ends_with(".internal")
        || name.ends_with(".test")
}

#[cfg(test)]
mod tests {
    use super::is_local_or_internal_name;

    #[test]
    fn local_names_skip_public_fallback() {
        for host in [
            "localhost",
            "printer.local",
            "router.lan",
            "service.internal",
            "fixture.test.",
            "nas",
            "printer",
            "router.home.arpa",
        ] {
            assert!(is_local_or_internal_name(host));
        }
    }

    #[test]
    fn public_names_can_use_public_fallback() {
        assert!(!is_local_or_internal_name("netscli.com"));
    }
}
