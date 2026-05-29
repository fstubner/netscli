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
pub use types::DnsRecord;
