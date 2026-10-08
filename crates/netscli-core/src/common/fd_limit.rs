//! Raise the soft open-file limit before a scan fans out.
//!
//! Every probe in flight holds a socket. The default concurrency is 256, and
//! macOS's default soft limit on open files is also 256, so a scan at the
//! default concurrency there runs out of descriptors once the process's own
//! files are counted. Connects then fail with EMFILE, which reads as a
//! filtered port or an error rather than as the limit it is. The hard limit
//! is normally far higher, and raising the soft limit up to it needs no
//! privileges.

use std::sync::Once;

/// Enough for the 1024-wide concurrency ceiling plus the process's own files,
/// and no higher than macOS accepts for a soft limit (`OPEN_MAX`).
const WANTED: libc::rlim_t = 10_240;

/// Raise the soft `RLIMIT_NOFILE` to [`WANTED`], or to the hard limit if that
/// is lower. Runs once per process; failure leaves the limit as it was.
pub(crate) fn raise_open_file_limit() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: both calls only read or write the `rlimit` passed to them.
        unsafe {
            if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 {
                return;
            }
            let wanted = WANTED.min(limit.rlim_max);
            if limit.rlim_cur >= wanted {
                return;
            }
            limit.rlim_cur = wanted;
            libc::setrlimit(libc::RLIMIT_NOFILE, &limit);
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_soft_limit_covers_a_full_concurrency_scan() {
        super::raise_open_file_limit();
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: as above.
        assert_eq!(
            unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) },
            0
        );
        assert!(
            limit.rlim_cur >= super::WANTED.min(limit.rlim_max),
            "soft limit {} below {}",
            limit.rlim_cur,
            super::WANTED.min(limit.rlim_max)
        );
    }
}
