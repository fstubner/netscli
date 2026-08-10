use serde_json::json;

pub fn tools_list() -> serde_json::Value {
    let tools = vec![
        json!({
            "name": "discover_network",
            "description": "Discover live hosts on a network subnet (ICMP ping with TCP connect fallback)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "subnet": {
                        "type": "string",
                        "description": "IPv4 subnet in CIDR notation (e.g. '192.168.1.0/24'). Omit to automatically detect local primary interface subnet."
                    },
                    "resolveHostnames": {
                        "type": "boolean",
                        "default": false,
                        "description": "Whether to perform reverse DNS lookups for discovered IP addresses."
                    },
                    "timeout": {
                        "type": "number",
                        "default": 1000,
                        "description": "Per-host ping timeout in milliseconds (10-600000ms)."
                    },
                    "maxConcurrent": {
                        "type": "number",
                        "default": 256,
                        "description": "Maximum number of simultaneous host discovery probes (1-4096)."
                    }
                }
            }
        }),
        json!({
            "name": "scan_ports",
            "description": "Scan TCP ports on a target host to identify listening network services",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": {
                        "type": "string",
                        "description": "Target hostname or IP address (e.g. '192.168.1.1' or 'example.com')."
                    },
                    "ports": {
                        "type": "array",
                        "items": { "type": "number" },
                        "description": "Array of TCP port numbers to scan (e.g. [22, 80, 443]). Omit to scan top common ports."
                    },
                    "timeout": {
                        "type": "number",
                        "default": 500,
                        "description": "Per-port TCP connect timeout in milliseconds."
                    },
                    "maxConcurrent": {
                        "type": "number",
                        "default": 256,
                        "description": "Maximum concurrent TCP connect probes."
                    }
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
                    "host": {
                        "type": "string",
                        "description": "Target hostname or IP address to ping."
                    },
                    "count": {
                        "type": "number",
                        "default": 1,
                        "minimum": 1,
                        "maximum": 256,
                        "description": "Number of ICMP/TCP probes to send."
                    },
                    "timeout": {
                        "type": "number",
                        "default": 1000,
                        "description": "Per-probe timeout in milliseconds."
                    },
                    "maxConcurrent": {
                        "type": "number",
                        "default": 64,
                        "description": "Maximum concurrent probes."
                    }
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
                    "host": {
                        "type": "string",
                        "description": "Domain name or hostname to query."
                    },
                    "type": {
                        "type": "string",
                        "default": "A",
                        "enum": ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SRV", "PTR", "SOA", "CAA", "ALL", "ANY"],
                        "description": "DNS record type to look up. Use ALL or ANY for comprehensive record retrieval."
                    }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "get_arp_table",
            "description": "Get ARP/neighbor table with offline IEEE OUI vendor resolution",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "inspect_host",
            "description": "Inspect a host (ping + TCP port scan + optional DNS resolution)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": {
                        "type": "string",
                        "description": "Target hostname or IP address."
                    },
                    "ports": {
                        "type": "array",
                        "items": { "type": "number" },
                        "description": "Optional custom TCP ports to scan during inspection."
                    }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "sweep_network",
            "description": "Sweep a network (discover live hosts then scan TCP ports on each discovered host)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "subnet": {
                        "type": "string",
                        "description": "IPv4 subnet CIDR (e.g. '192.168.1.0/24'). Omit to auto-detect local primary subnet."
                    },
                    "ports": {
                        "type": "array",
                        "items": { "type": "number" },
                        "description": "Array of TCP ports to scan per live host."
                    },
                    "resolveHostnames": {
                        "type": "boolean",
                        "default": false,
                        "description": "Whether to resolve hostnames for discovered hosts."
                    },
                    "timeout": {
                        "type": "number",
                        "default": 500,
                        "description": "Per-probe timeout in milliseconds."
                    },
                    "maxConcurrent": {
                        "type": "number",
                        "default": 256,
                        "description": "Maximum concurrent tasks."
                    }
                }
            }
        }),
        json!({
            "name": "trace_route",
            "description": "Trace network route hops to a destination host (tracert/traceroute)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": {
                        "type": "string",
                        "description": "Target destination hostname or IP address."
                    },
                    "maxHops": {
                        "type": "number",
                        "default": 30,
                        "description": "Maximum number of hops (TTL) to traverse (1-255)."
                    },
                    "resolve": {
                        "type": "boolean",
                        "default": false,
                        "description": "Whether to resolve IP addresses to hostnames for each hop."
                    }
                },
                "required": ["host"]
            }
        }),
        json!({
            "name": "list_network_interfaces",
            "description": "List network interfaces with MAC addresses, IP assignments, and status flags",
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
            "description": "Capture network packets to a PCAP file in one blocking tool call (may require root/admin). For longer captures, prefer start_pcap_capture then poll status and fetch the result.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "interface": { "type": "string", "description": "Network interface name (e.g. 'eth0' or 'Ethernet')." },
                    "filter": { "type": "string", "description": "Optional BPF packet filter expression (e.g. 'tcp port 80')." },
                    "duration": { "type": "number", "default": 10, "description": "Capture duration limit in seconds." },
                    "outputFile": { "type": "string", "default": "capture.pcap", "description": "Output .pcap filename." },
                    "maxPackets": { "type": "number", "description": "Maximum number of packets to capture before stopping." }
                },
                "required": ["interface"]
            }
        }));
        tools.push(json!({
            "name": "start_pcap_capture",
            "description": "Start packet capture as a background MCP job. Poll with get_pcap_capture_status, then fetch output with get_pcap_capture_result.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "interface": { "type": "string", "description": "Network interface name." },
                    "filter": { "type": "string", "description": "Optional BPF packet filter expression." },
                    "duration": { "type": "number", "default": 10, "description": "Capture duration limit in seconds." },
                    "outputFile": { "type": "string", "default": "capture.pcap", "description": "Output .pcap filename." },
                    "maxPackets": { "type": "number", "description": "Maximum packets limit." }
                },
                "required": ["interface"]
            }
        }));
        tools.push(json!({
            "name": "get_pcap_capture_status",
            "description": "Get the running/completed/failed status for a packet capture job.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "jobId": { "type": "string", "description": "The background capture job ID returned by start_pcap_capture." }
                },
                "required": ["jobId"]
            }
        }));
        tools.push(json!({
            "name": "get_pcap_capture_result",
            "description": "Fetch the result for a completed packet capture job, including parsed packet summaries when available.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "jobId": { "type": "string", "description": "The completed capture job ID." }
                },
                "required": ["jobId"]
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
