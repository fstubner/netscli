mod lookup;
mod records;
mod resolver;
mod reverse;
mod types;

pub use lookup::{
    lookup_all_records_timeout, lookup_record_timeout, resolve_a, resolve_a_timeout, resolve_aaaa,
    resolve_aaaa_timeout,
};
pub use records::parse_record_type;
pub use reverse::{reverse_lookup_best_effort_timeout, reverse_lookup_timeout};
// Crate-internal: discover reuses it to sanitise mDNS names, which are
// remote-controlled strings exactly like the PTR and LLMNR replies this was
// written for. Not public -- it is a detail of how names are cleaned, not
// part of the DNS surface.
#[cfg(feature = "mdns")]
pub(crate) use reverse::normalize_hostname;
pub use types::DnsRecord;
