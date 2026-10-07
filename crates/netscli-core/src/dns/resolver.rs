use hickory_resolver::TokioResolver;
use std::sync::OnceLock;

use crate::error::{Error, Result};

/// The only resolver NetsCLI uses: the system's own DNS configuration.
///
/// There is deliberately no fallback. Until 0.3.5 a name the system resolver
/// could not answer (including a plain "no records" answer) was asked again of
/// Cloudflare's public resolver, which sent names the user looked up to a
/// third party without saying so. A lookup now goes only to the DNS servers
/// the system is configured to use.
///
/// Shared, because parsing the system config (`/etc/resolv.conf` or the
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

#[cfg(test)]
mod tests {
    /// Lookups must only ever reach the system's DNS servers. A second
    /// resolver built from one of hickory's public presets is how the old
    /// Cloudflare fallback worked, and nothing else would notice one coming
    /// back: it changes no result, only where the question goes.
    #[test]
    fn no_resolver_other_than_the_system_one() {
        // Assembled at run time so this file does not match itself.
        let banned = [
            ["Resolver", "Config"].concat(),
            ["builder_with", "_config"].concat(),
            ["CLOUD", "FLARE"].concat(),
            ["GOO", "GLE"].concat(),
            ["QUA", "D9"].concat(),
        ];
        let mut dirs = vec![std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src")];
        let mut hits = Vec::new();
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(&dir).expect("read src dir") {
                let path = entry.expect("dir entry").path();
                if path.is_dir() {
                    dirs.push(path);
                } else if path.extension().is_some_and(|ext| ext == "rs") {
                    let text = std::fs::read_to_string(&path).expect("read source file");
                    for word in &banned {
                        if text.contains(word.as_str()) {
                            hits.push(format!("{} mentions {word}", path.display()));
                        }
                    }
                }
            }
        }
        assert!(
            hits.is_empty(),
            "a non-system DNS resolver is back: {hits:?}"
        );
    }
}
