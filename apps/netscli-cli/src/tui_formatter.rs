mod common;
mod discovery;
mod dns;
mod host;
mod inspect;
mod network;
#[cfg(feature = "pcap")]
mod pcap;
mod ping;
mod scan;

pub struct Formatter;
