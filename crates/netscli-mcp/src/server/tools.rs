use serde_json::json;

pub fn tools_list() -> serde_json::Value {
    let tools = vec![
        json!({
            "name": "discover_network",
            "description": "Discover live hosts on a network subnet",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "subnet": {
                        "type": "string",
                        "default": "192.168.1.0/24",
                        "description": "IPv4 CIDR, at most a /16. Defaults to the local subnet."
                    },
                    "resolveHostnames": { "type": "boolean", "default": false },
                    "timeout": { "type": "number", "default": 1000, "minimum": 10, "maximum": 600000 },
                    "maxConcurrent": { "type": "number", "default": 256, "minimum": 1, "maximum": 1024 }
                }
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": true
            }
        }),
        json!({
            "name": "scan_ports",
            "description": "Scan TCP ports on a host",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "ports": {
                        "type": "array",
                        "items": { "type": "number", "minimum": 1, "maximum": 65535 },
                        "maxItems": 4096
                    },
                    "timeout": { "type": "number", "default": 500, "minimum": 10, "maximum": 600000 },
                    "maxConcurrent": { "type": "number", "default": 256, "minimum": 1, "maximum": 1024 }
                },
                "required": ["host"]
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": true
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
                    "timeout": { "type": "number", "default": 1000, "minimum": 10, "maximum": 600000 }
                },
                "required": ["host"]
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": true
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
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": true
            }
        }),
        json!({
            "name": "get_arp_table",
            "description": "Get ARP/neighbor table with vendor information",
            "inputSchema": {
                "type": "object",
                "properties": {}
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": false
            }
        }),
        json!({
            "name": "inspect_host",
            "description": "Inspect a host (ping + port scan + optional DNS resolution)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": { "type": "string" },
                    "ports": {
                        "type": "array",
                        "items": { "type": "number", "minimum": 1, "maximum": 65535 },
                        "maxItems": 4096
                    },
                    "timeout": { "type": "number", "default": 500, "minimum": 10, "maximum": 600000 },
                    "maxConcurrent": { "type": "number", "default": 256, "minimum": 1, "maximum": 1024 }
                },
                "required": ["host"]
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": true
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
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": true
            }
        }),
        json!({
            "name": "list_network_interfaces",
            "description": "List network interfaces with details",
            "inputSchema": {
                "type": "object",
                "properties": {}
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": false
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
                    "interface": { "type": "string" },
                    "filter": { "type": "string" },
                    "duration": { "type": "number", "default": 10, "minimum": 1, "maximum": 120 },
                    "outputFile": { "type": "string", "default": "capture.pcap" },
                    "maxPackets": { "type": "number" }
                },
                "required": ["interface"]
            },
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": false,
                "openWorldHint": true
            }
        }));
        tools.push(json!({
            "name": "start_pcap_capture",
            "description": "Start packet capture as a background MCP job. Poll with get_pcap_capture_status, then fetch output with get_pcap_capture_result.",
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
            },
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": false,
                "openWorldHint": true
            }
        }));
        tools.push(json!({
            "name": "get_pcap_capture_status",
            "description": "Get the running/completed/failed status for a packet capture job.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "jobId": { "type": "string" }
                },
                "required": ["jobId"]
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": false
            }
        }));
        tools.push(json!({
            "name": "get_pcap_capture_result",
            "description": "Fetch the result for a completed packet capture job, including parsed packet summaries when available.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "jobId": { "type": "string" }
                },
                "required": ["jobId"]
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": false
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
            },
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "openWorldHint": true
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

/// A tool that ran and failed, in the shape MCP defines for that.
///
/// `isError` is what tells a client the call completed but the work did not,
/// so the model can read the reason and adapt. A JSON-RPC error in the same
/// situation reads as a transport or server fault.
pub(super) fn mcp_tool_error_text(message: &str) -> serde_json::Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true,
    })
}
