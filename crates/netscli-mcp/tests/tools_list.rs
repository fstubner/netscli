use netscli_mcp::server::tools_list;

#[test]
fn tools_list_contains_expected_tools() {
    let v = tools_list();
    let tools = v
        .get("tools")
        .and_then(|t| t.as_array())
        .expect("tools_list() must return { tools: [...] }");

    let mut names: Vec<&str> = tools
        .iter()
        .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
        .collect();
    names.sort_unstable();

    let expected = vec![
        "discover_network",
        "dns_lookup",
        "get_arp_table",
        "inspect_host",
        "list_network_interfaces",
        "ping_host",
        "scan_ports",
        "sweep_network",
    ];

    #[cfg(feature = "pcap")]
    let expected = {
        let mut expected = expected;
        expected.push("capture_pcap");
        expected
    };

    for e in expected {
        assert!(names.contains(&e), "missing tool: {e}");
    }

    // Basic sanity: each tool should declare an input schema.
    for tool in tools {
        assert!(
            tool.get("inputSchema").is_some(),
            "tool missing inputSchema: {tool}"
        );
    }
}
