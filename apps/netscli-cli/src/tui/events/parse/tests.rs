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
    let args = pcap(r#"/pcap eth0 --filter "tcp port 80" --duration 5 --max-packets 100"#).unwrap();
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
