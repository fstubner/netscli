//! What follows a slash command, read into values.
//!
//! These parsers used to skip anything they did not understand. `/ping host
//! abc` pinged four times, `/mdns --timeout abc` used the default, `/discover
//! a b` dropped the `b`, and `/arp add 1.2.3.4` showed the ARP table. A silent
//! default can cost more than the retyped line an error does, so each of these
//! returns the message to show for a word it cannot use. The messages are
//! whole sentences, for `Formatter::format_error`.
//!
//! They take the command split into words, the command itself first, and do no
//! I/O, so they can be tested without a network.

use mac_address::MacAddress;
use netscli_core::MAX_PING_COUNT;
use std::net::IpAddr;
use std::str::FromStr;

const PING_USAGE: &str = "Usage: /ping <host> [count]";
const DISCOVER_USAGE: &str = "Usage: /discover [subnet] [--resolve]";
const MDNS_USAGE: &str = "Usage: /mdns [--timeout <ms>]";
const ARP_USAGE: &str = "Usage: /arp [add <ip> <mac> | del <ip> | clear]";

/// `/ping <host> [count]`
pub(super) fn parse_ping(parts: &[&str]) -> Result<(String, u32), String> {
    let [_, host, rest @ ..] = parts else {
        return Err(PING_USAGE.to_string());
    };
    let count = match rest {
        [] => 4,
        [count] => match count.parse::<u32>() {
            Ok(n) if n >= 1 => n.min(MAX_PING_COUNT),
            _ => {
                return Err(format!(
                    "Invalid count '{count}' (expected 1 or more). {PING_USAGE}"
                ))
            }
        },
        _ => return Err(PING_USAGE.to_string()),
    };
    Ok((host.to_string(), count))
}

/// `/discover [subnet] [--resolve]`. Names are looked up only when asked for,
/// as everywhere else.
pub(super) fn parse_discover(parts: &[&str]) -> Result<(Option<String>, bool), String> {
    let mut subnet = None;
    let mut resolve = false;
    for tok in parts.iter().skip(1) {
        match *tok {
            "--resolve" | "-r" => resolve = true,
            flag if flag.starts_with('-') => {
                return Err(format!("Unknown flag: {flag}. {DISCOVER_USAGE}"))
            }
            value if subnet.is_none() => subnet = Some(value.to_string()),
            extra => return Err(format!("Unexpected argument: {extra}. {DISCOVER_USAGE}")),
        }
    }
    Ok((subnet, resolve))
}

/// `/mdns [--timeout <ms>]`, in milliseconds. `--timeout-ms` is the CLI's
/// name for it.
pub(super) fn parse_mdns(parts: &[&str]) -> Result<u64, String> {
    let mut timeout_ms: u64 = 3000;
    let mut i = 1;
    while i < parts.len() {
        match parts[i] {
            "--timeout" | "--timeout-ms" | "-t" => {
                let Some(value) = parts.get(i + 1) else {
                    return Err(format!("Missing value for {}. {MDNS_USAGE}", parts[i]));
                };
                let Ok(ms) = value.parse::<u64>() else {
                    return Err(format!(
                        "Invalid {} '{value}' (expected milliseconds). {MDNS_USAGE}",
                        parts[i]
                    ));
                };
                timeout_ms = ms.clamp(100, netscli_core::MAX_MDNS_TIMEOUT_MS);
                i += 2;
            }
            other => return Err(format!("Unexpected argument: {other}. {MDNS_USAGE}")),
        }
    }
    Ok(timeout_ms)
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ArpCommand {
    Show,
    Add(IpAddr, MacAddress),
    Delete(IpAddr),
    Clear,
}

/// `/arp`, `/arp add <ip> <mac>`, `/arp del <ip>` (or `delete`, the CLI's
/// word) and `/arp clear`.
pub(super) fn parse_arp(parts: &[&str]) -> Result<ArpCommand, String> {
    match parts.get(1..).unwrap_or_default() {
        [] => Ok(ArpCommand::Show),
        ["clear"] => Ok(ArpCommand::Clear),
        ["add", ip, mac] => {
            let ip = IpAddr::from_str(ip).map_err(|_| format!("Invalid IP '{ip}'. {ARP_USAGE}"))?;
            let mac = MacAddress::from_str(mac)
                .map_err(|_| format!("Invalid MAC '{mac}'. {ARP_USAGE}"))?;
            Ok(ArpCommand::Add(ip, mac))
        }
        ["del" | "delete", ip] => {
            let ip = IpAddr::from_str(ip).map_err(|_| format!("Invalid IP '{ip}'. {ARP_USAGE}"))?;
            Ok(ArpCommand::Delete(ip))
        }
        _ => Err(ARP_USAGE.to_string()),
    }
}

/// What `/pcap` was given.
#[derive(Debug, Default, PartialEq, Eq)]
#[cfg_attr(not(feature = "pcap"), allow(dead_code))]
pub(super) struct PcapArgs {
    pub(super) check: bool,
    pub(super) interface: Option<String>,
    pub(super) filter: Option<String>,
    pub(super) duration: Option<u64>,
    pub(super) output: Option<String>,
    pub(super) max_packets: Option<usize>,
}

/// `/pcap [--check] <iface> [--filter <expr>] [--duration <secs>] [--output
/// <file>] [--max-packets <n>]`. The words arrive already split by
/// `tui_args::split_args`, so a filter with spaces in it is one word, written
/// in quotes.
#[cfg_attr(not(feature = "pcap"), allow(dead_code))]
pub(super) fn parse_pcap(parts: &[&str]) -> Result<PcapArgs, String> {
    let mut args = PcapArgs::default();
    let mut i = 1;
    while i < parts.len() {
        let flag = parts[i];
        let value = || {
            parts
                .get(i + 1)
                .copied()
                .ok_or_else(|| format!("Missing value for {flag}"))
        };
        match flag {
            "--check" => {
                args.check = true;
                i += 1;
                continue;
            }
            "-i" | "--interface" => args.interface = Some(value()?.to_string()),
            "--filter" => args.filter = Some(value()?.to_string()),
            "--output" => args.output = Some(value()?.to_string()),
            "--duration" => {
                args.duration = Some(
                    value()?
                        .parse()
                        .map_err(|_| "Invalid --duration (expected seconds)".to_string())?,
                );
            }
            "--max-packets" => {
                args.max_packets = Some(
                    value()?
                        .parse()
                        .map_err(|_| "Invalid --max-packets (expected integer)".to_string())?,
                );
            }
            flag if flag.starts_with('-') => return Err(format!("Unknown flag: {flag}")),
            word => {
                // The interface is the one bare word. A second one is
                // usually the rest of a filter that was not quoted, which
                // used to be dropped without a word, leaving a capture of
                // everything `tcp`.
                if args.interface.is_some() {
                    return Err(format!(
                        "Unexpected argument: {word}. A filter with spaces needs quotes, \
                         as in --filter \"tcp port 80\""
                    ));
                }
                args.interface = Some(word.to_string());
                i += 1;
                continue;
            }
        }
        i += 2;
    }
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(input: &str) -> Vec<String> {
        crate::tui_args::split_args(input).unwrap()
    }

    fn ping(input: &str) -> Result<(String, u32), String> {
        let words = words(input);
        parse_ping(&words.iter().map(String::as_str).collect::<Vec<_>>())
    }

    fn discover(input: &str) -> Result<(Option<String>, bool), String> {
        let words = words(input);
        parse_discover(&words.iter().map(String::as_str).collect::<Vec<_>>())
    }

    fn mdns(input: &str) -> Result<u64, String> {
        let words = words(input);
        parse_mdns(&words.iter().map(String::as_str).collect::<Vec<_>>())
    }

    fn arp(input: &str) -> Result<ArpCommand, String> {
        let words = words(input);
        parse_arp(&words.iter().map(String::as_str).collect::<Vec<_>>())
    }

    fn pcap(input: &str) -> Result<PcapArgs, String> {
        let words = words(input);
        parse_pcap(&words.iter().map(String::as_str).collect::<Vec<_>>())
    }

    #[test]
    fn ping_takes_a_host_and_an_optional_count() {
        assert_eq!(
            ping("/ping example.com").unwrap(),
            ("example.com".into(), 4)
        );
        assert_eq!(
            ping("/ping example.com 10").unwrap(),
            ("example.com".into(), 10)
        );
        assert_eq!(ping("/ping example.com 100000").unwrap().1, MAX_PING_COUNT);
    }

    #[test]
    fn ping_refuses_what_it_cannot_read_instead_of_pinging_four_times() {
        assert!(ping("/ping").unwrap_err().starts_with("Usage"));
        assert!(ping("/ping example.com abc")
            .unwrap_err()
            .contains("Invalid count 'abc'"));
        assert!(ping("/ping example.com 0").is_err());
        assert!(ping("/ping example.com 3 extra")
            .unwrap_err()
            .starts_with("Usage"));
    }

    #[test]
    fn discover_takes_a_subnet_and_resolve_only_when_asked() {
        assert_eq!(discover("/discover").unwrap(), (None, false));
        assert_eq!(
            discover("/discover 10.0.0.0/24").unwrap(),
            (Some("10.0.0.0/24".into()), false)
        );
        assert_eq!(
            discover("/discover --resolve 10.0.0.0/24").unwrap(),
            (Some("10.0.0.0/24".into()), true)
        );
        assert_eq!(discover("/discover -r").unwrap(), (None, true));
    }

    #[test]
    fn discover_refuses_a_second_subnet_and_unknown_flags() {
        let extra = discover("/discover 10.0.0.0/24 192.168.0.0/24").unwrap_err();
        assert!(
            extra.contains("Unexpected argument: 192.168.0.0/24"),
            "{extra}"
        );
        assert!(discover("/discover --bogus")
            .unwrap_err()
            .contains("Unknown flag"));
    }

    #[test]
    fn mdns_reads_its_timeout_and_clamps_it() {
        assert_eq!(mdns("/mdns").unwrap(), 3000);
        assert_eq!(mdns("/mdns --timeout 5000").unwrap(), 5000);
        assert_eq!(mdns("/mdns --timeout-ms 5000").unwrap(), 5000);
        assert_eq!(mdns("/mdns -t 1").unwrap(), 100);
        assert_eq!(
            mdns("/mdns --timeout 99999999").unwrap(),
            netscli_core::MAX_MDNS_TIMEOUT_MS
        );
    }

    #[test]
    fn mdns_refuses_a_timeout_it_cannot_read_instead_of_using_3000() {
        assert!(mdns("/mdns --timeout abc")
            .unwrap_err()
            .contains("Invalid --timeout 'abc'"));
        assert!(mdns("/mdns --timeout")
            .unwrap_err()
            .contains("Missing value"));
        assert!(mdns("/mdns stray")
            .unwrap_err()
            .contains("Unexpected argument: stray"));
    }

    #[test]
    fn arp_shows_adds_deletes_and_clears() {
        assert_eq!(arp("/arp").unwrap(), ArpCommand::Show);
        assert_eq!(arp("/arp clear").unwrap(), ArpCommand::Clear);
        let ip: IpAddr = "10.0.0.5".parse().unwrap();
        assert_eq!(arp("/arp del 10.0.0.5").unwrap(), ArpCommand::Delete(ip));
        assert_eq!(arp("/arp delete 10.0.0.5").unwrap(), ArpCommand::Delete(ip));
        let mac = MacAddress::from_str("aa:bb:cc:dd:ee:ff").unwrap();
        assert_eq!(
            arp("/arp add 10.0.0.5 aa:bb:cc:dd:ee:ff").unwrap(),
            ArpCommand::Add(ip, mac)
        );
    }

    #[test]
    fn arp_does_not_fall_back_to_the_table_for_what_it_cannot_read() {
        // `add` with no MAC used to show the ARP table.
        assert!(arp("/arp add 10.0.0.5")
            .unwrap_err()
            .starts_with("Usage: /arp"));
        assert!(arp("/arp add nope aa:bb:cc:dd:ee:ff")
            .unwrap_err()
            .contains("Invalid IP"));
        assert!(arp("/arp add 10.0.0.5 nope")
            .unwrap_err()
            .contains("Invalid MAC"));
        assert!(arp("/arp del").is_err());
        assert!(arp("/arp clear now").is_err());
        assert!(arp("/arp flush").is_err());
    }

    #[test]
    fn pcap_keeps_a_quoted_filter_whole() {
        // `--filter tcp port 80` used to capture with the filter `tcp`.
        let args =
            pcap(r#"/pcap eth0 --filter "tcp port 80" --duration 5 --max-packets 100"#).unwrap();
        assert_eq!(args.interface.as_deref(), Some("eth0"));
        assert_eq!(args.filter.as_deref(), Some("tcp port 80"));
        assert_eq!(args.duration, Some(5));
        assert_eq!(args.max_packets, Some(100));
    }

    #[test]
    fn pcap_says_so_when_a_filter_was_not_quoted() {
        let err = pcap("/pcap eth0 --filter tcp port 80").unwrap_err();
        assert!(err.contains("Unexpected argument: port"), "{err}");
        assert!(err.contains("--filter \"tcp port 80\""), "{err}");
    }

    #[test]
    fn pcap_still_reads_its_other_forms() {
        assert!(pcap("/pcap --check").unwrap().check);
        assert_eq!(
            pcap("/pcap -i eth0").unwrap().interface.as_deref(),
            Some("eth0")
        );
        assert_eq!(
            pcap(r"/pcap eth0 --output C:\captures\x.pcap")
                .unwrap()
                .output
                .as_deref(),
            Some(r"C:\captures\x.pcap")
        );
        assert!(pcap("/pcap eth0 --duration soon")
            .unwrap_err()
            .contains("--duration"));
        assert!(pcap("/pcap eth0 --filter")
            .unwrap_err()
            .contains("Missing value for --filter"));
        assert!(pcap("/pcap eth0 --bogus")
            .unwrap_err()
            .contains("Unknown flag: --bogus"));
    }
}
