use std::process::Stdio;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

async fn spawn_mcp() -> (
    tokio::process::Child,
    tokio::process::ChildStdin,
    tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_netscli"))
        .arg("serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn netscli serve");

    let stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let lines = BufReader::new(stdout).lines();

    (child, stdin, lines)
}

async fn read_json_line(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
) -> Value {
    let line = timeout(Duration::from_secs(15), lines.next_line())
        .await
        .expect("timeout waiting for MCP response")
        .expect("read line")
        .expect("server closed stdout");

    serde_json::from_str(&line).expect("response must be valid json")
}

async fn initialize(
    stdin: &mut tokio::process::ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
) {
    stdin
        .write_all(
            br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}
"#,
        )
        .await
        .expect("write initialize");
    stdin.flush().await.expect("flush initialize");

    let init_resp = read_json_line(lines).await;
    assert_eq!(init_resp["id"], 1);
    assert!(init_resp.get("error").is_none() || init_resp["error"].is_null());
    assert_eq!(init_resp["result"]["protocolVersion"], "2024-11-05");
}

#[tokio::test]
async fn mcp_initialize_then_tools_list() {
    let (mut child, mut stdin, mut lines) = spawn_mcp().await;

    initialize(&mut stdin, &mut lines).await;

    // tools/list
    stdin
        .write_all(
            br#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
"#,
        )
        .await
        .expect("write tools/list");
    stdin.flush().await.expect("flush tools/list");

    let tools_resp = read_json_line(&mut lines).await;
    assert_eq!(tools_resp["id"], 2);
    let tools = tools_resp["result"]["tools"]
        .as_array()
        .expect("tools array");
    assert!(!tools.is_empty());

    // close stdin so server exits
    drop(stdin);
    let _ = timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("timeout waiting for server exit")
        .expect("wait");
}

#[tokio::test]
async fn mcp_requires_initialize_for_methods() {
    let (mut child, mut stdin, mut lines) = spawn_mcp().await;

    // Call scan_ports before initialize.
    stdin
        .write_all(
            br#"{"jsonrpc":"2.0","id":1,"method":"scan_ports","params":{"host":"127.0.0.1","ports":[80]}}
"#,
        )
        .await
        .expect("write scan_ports");
    stdin.flush().await.expect("flush scan_ports");

    let resp = read_json_line(&mut lines).await;
    assert_eq!(resp["id"], 1);
    assert_eq!(resp["error"]["code"], -32002);
    assert!(resp["error"]["message"]
        .as_str()
        .unwrap_or("")
        .contains("Not initialized"));

    drop(stdin);
    let _ = timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("timeout waiting for server exit")
        .expect("wait");
}

#[tokio::test]
async fn mcp_tools_call_rejects_large_subnet() {
    let (mut child, mut stdin, mut lines) = spawn_mcp().await;
    initialize(&mut stdin, &mut lines).await;

    stdin
        .write_all(
            br#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"discover_network","arguments":{"subnet":"10.0.0.0/8"}}}
"#,
        )
        .await
        .expect("write tools/call discover_network");
    stdin.flush().await.expect("flush tools/call discover_network");

    let resp = read_json_line(&mut lines).await;
    assert_eq!(resp["id"], 2);
    assert_eq!(resp["error"]["code"], -32602);
    assert!(resp["error"]["message"]
        .as_str()
        .unwrap_or("")
        .contains("subnet too large"));

    drop(stdin);
    let _ = timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("timeout waiting for server exit")
        .expect("wait");
}

#[tokio::test]
async fn mcp_tools_call_rejects_port_zero() {
    let (mut child, mut stdin, mut lines) = spawn_mcp().await;
    initialize(&mut stdin, &mut lines).await;

    stdin
        .write_all(
            br#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scan_ports","arguments":{"host":"127.0.0.1","ports":[0]}}}
"#,
        )
        .await
        .expect("write tools/call scan_ports");
    stdin.flush().await.expect("flush tools/call scan_ports");

    let resp = read_json_line(&mut lines).await;
    assert_eq!(resp["id"], 2);
    assert_eq!(resp["error"]["code"], -32602);
    assert!(resp["error"]["message"]
        .as_str()
        .unwrap_or("")
        .contains("port 0"));

    drop(stdin);
    let _ = timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("timeout waiting for server exit")
        .expect("wait");
}
