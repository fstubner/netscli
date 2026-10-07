// Drive `netscli serve` with the official MCP TypeScript SDK client.
//
// The Rust tests check the server's replies against what the server itself
// expects. That is how every reply carried both `result` and `error` for
// months with all of them green, while the SDK most MCP clients are built on
// dropped those replies and timed out waiting for `initialize`. This asks the
// SDK instead.
//
// Usage: node smoke.mjs <path to the netscli binary>
// Exits 0 when every check passes, 1 on any failure, 2 on bad usage.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const OVERALL_TIMEOUT_MS = 30_000;

const binary = process.argv[2];
if (!binary) {
  console.error('usage: node smoke.mjs <path to the netscli binary>');
  process.exit(2);
}

function fail(message) {
  console.error(`mcp-smoke: FAIL: ${message}`);
  process.exit(1);
}

// One deadline for the whole run, so a server that never answers fails here
// rather than on the SDK's own 60 s request timeout.
const deadline = setTimeout(
  () => fail(`no complete exchange with the server within ${OVERALL_TIMEOUT_MS / 1000} s`),
  OVERALL_TIMEOUT_MS,
);

const transport = new StdioClientTransport({ command: binary, args: ['serve'] });
const client = new Client({ name: 'netscli-mcp-smoke', version: '1.0.0' });
// The SDK drops a message it cannot validate and reports it only here. The
// request it answered then waits forever, so this is the useful error.
client.onerror = (error) => fail(`the SDK rejected a message from the server: ${error?.message ?? error}`);

let summary;
try {
  await client.connect(transport);
  const server = client.getServerVersion();
  if (server?.name !== 'netscli') {
    fail(`initialize named the server ${JSON.stringify(server)}, expected netscli`);
  }

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const expected of ['list_network_interfaces', 'scan_ports']) {
    if (!names.includes(expected)) {
      fail(`tools/list has no ${expected}. It listed: ${names.join(', ')}`);
    }
  }

  // Read-only, and sends nothing on the network.
  const listed = await client.callTool({ name: 'list_network_interfaces', arguments: {} });
  if (listed.isError) {
    fail(`list_network_interfaces failed: ${JSON.stringify(listed.content)}`);
  }
  const text = listed.content?.[0]?.text;
  let interfaces;
  try {
    interfaces = JSON.parse(text);
  } catch {
    fail(`list_network_interfaces returned text that is not JSON: ${text}`);
  }
  if (!Array.isArray(interfaces)) {
    fail(`list_network_interfaces returned ${typeof interfaces}, expected an array`);
  }

  // An error reply has to arrive too. scan_ports with no host is refused
  // before anything is sent.
  let refused;
  try {
    await client.callTool({ name: 'scan_ports', arguments: {} });
  } catch (error) {
    refused = error;
  }
  if (refused?.code !== -32602) {
    const got = refused ? `${refused.code}: ${refused.message}` : 'a result';
    fail(`scan_ports with no host should fail with -32602, got ${got}`);
  }

  summary = `${server.name} ${server.version}, ${tools.length} tools, ${interfaces.length} interfaces listed, error reply delivered`;
} catch (error) {
  fail(error?.message ?? String(error));
}

clearTimeout(deadline);
await client.close();
console.log(`mcp-smoke: ok: ${summary}`);
process.exit(0);
