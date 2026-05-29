use serde_json::json;

pub fn tools_list() -> serde_json::Value {
    let tools = vec![
        json!({
            "name": "discover_network",
            "description": "Discover live hosts on a network subnet",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "subnet": { "type": "string", "default": "192.168.1.0/24" },
                    "resolveHostnames": { "type": "boolean", "default": false },
                    "timeout": { "type": "number", "default": 1000 },
                    "maxConcurrent": { "type": "number", "default": 256 }
                }
            }
        }),
        json!({
            "name": "scan_ports",
            "description": "Scan TCP ports on a host",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "ports": { "type": "array", "items": { "type": "number" } },
                    "timeout": { "type": "number", "default": 500 },
                    "maxConcurrent": { "type": "number", "default": 256 }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "ping_host",
            "description": "Ping a host (ICMP with TCP-connect fallback). Returns a PingSummary with aggregate loss and min/avg/max RTT when count > 1.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "count": { "type": "number", "default": 1, "minimum": 1, "maximum": 256 },
                    "timeout": { "type": "number", "default": 1000 },
                    "maxConcurrent": { "type": "number", "default": 64 }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "dns_lookup",
            "description": "DNS lookup (A, AAAA, CNAME, MX, NS, TXT, SRV, PTR, SOA, CAA, or ALL/ANY for every record type)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "type": {
                        "type": "string",
                        "default": "A",
                        "enum": ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SRV", "PTR", "SOA", "CAA", "ALL", "ANY"]
                    }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "get_arp_table",
            "description": "Get ARP/neighbor table with vendor information",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "inspect_host",
            "description": "Inspect a host (ping + port scan + optional DNS resolution)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "ports": { "type": "array", "items": { "type": "number" } }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "sweep_network",
            "description": "Sweep a network (discover hosts then scan ports)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "subnet": { "type": "string", "default": "192.168.1.0/24" },
                    "ports": { "type": "array", "items": { "type": "number" } },
                    "resolveHostnames": { "type": "boolean", "default": false },
                    "timeout": { "type": "number", "default": 500 },
                    "maxConcurrent": { "type": "number", "default": 256 }
                }
            }
        }),
        json!({
            "name": "list_network_interfaces",
            "description": "List network interfaces with details",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
    ];

    #[cfg(feature = "pcap")]
    let tools = {
        let mut tools = tools;
        tools.push(json!({
            "name": "capture_pcap",
            "description": "Capture network packets to a PCAP file (may require root/admin)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "interface": { "type": "string" },
                    "filter": { "type": "string" },
                    "duration": { "type": "number", "default": 10 },
                    "outputFile": { "type": "string", "default": "capture.pcap" },
                    "maxPackets": { "type": "number" }
                },
                "required": ["interface"]
            }
        }));
        tools
    };

    #[cfg(feature = "mdns")]
    let tools = {
        let mut tools = tools;
        tools.push(json!({
            "name": "discover_mdns",
            "description": "Discover devices on the local network via mDNS/DNS-SD (Bonjour). Returns services with their hostnames, resolved IPs, ports, and TXT properties. Much friendlier than IP-based discovery for named devices like printers, Chromecasts, or Homebridge accessories.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "timeout_ms": {
                        "type": "number",
                        "default": 3000,
                        "description": "How long to browse for responses. 3000-5000ms is typical; many devices re-announce on a multi-second cadence."
                    },
                    "service_types": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Explicit service types to browse (e.g. [\"_http._tcp.local.\", \"_airplay._tcp.local.\"]). Omit to use a curated default set."
                    }
                }
            }
        }));
        tools
    };

    json!({ "tools": tools })
}

pub(super) fn mcp_tool_result_text(val: serde_json::Value) -> serde_json::Value {
    json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string_pretty(&val).unwrap_or_else(|_| "<serialization error>".to_string())
            }
        ]
    })
}
