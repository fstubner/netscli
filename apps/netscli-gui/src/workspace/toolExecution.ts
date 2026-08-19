import { isTauri } from '../services/env';
import { validateFieldValue } from '../tools/fieldValidation';
import * as netscli from '../services/netscli';
import type { ToolResult } from '../types/app';
import type { DnsRecord } from '../types/netscli';
import { TOOL_CONFIG } from '../tools/registry';
import { emptyToUndefined, numberOrUndefined } from '../tools/presentation';
import type { WorkspaceTab } from '../tools/types';

type DownloadPath = string | null | undefined;

const DNS_ALL_RECORDS = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SRV', 'PTR', 'SOA', 'CAA'];

export async function downloadText(filename: string, mime: string, content: string): Promise<DownloadPath> {
  if (isTauri()) {
    try {
      return await netscli.exportTextFile(filename, content);
    } catch (error) {
      if (String(error).includes('Export cancelled')) return undefined;
      throw error;
    }
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return null;
}

export async function executeTool(
  tab: WorkspaceTab,
  opId: string,
  maxConcurrentProbes: number,
): Promise<ToolResult> {
  if (!isTauri()) {
    throw new Error("Tauri backend not available. Run 'npm run tauri dev' to execute tools.");
  }

  switch (tab.kind) {
    case 'scan':
      return {
        kind: 'scan',
        data: await netscli.scanPorts(
          tab.form.host.trim(),
          emptyToUndefined(tab.form.ports),
          opId,
          maxConcurrentProbes,
        ),
      };
    case 'ping':
      return {
        kind: 'ping',
        data: await netscli.pingHost(tab.form.host.trim(), boundedNumberOrUndefined(tab, 'count'), opId),
      };
    case 'trace':
      return {
        kind: 'trace',
        data: await netscli.traceRoute(
          tab.form.host.trim(),
          boundedNumberOrUndefined(tab, 'max_hops'),
          tab.form.resolve === 'On',
          opId,
        ),
      };
    case 'discover':
      return {
        kind: 'discover',
        data: await netscli.discoverNetwork(
          emptyToUndefined(tab.form.subnet),
          opId,
          true,
          maxConcurrentProbes,
        ),
      };
    case 'dns':
      return executeDns(tab, opId);
    case 'reverse':
      return {
        kind: 'reverse',
        data: await netscli.reverseDnsLookup(tab.form.ip.trim(), opId),
      };
    case 'inspect':
      return {
        kind: 'inspect',
        data: await netscli.inspectHost(tab.form.host.trim(), emptyToUndefined(tab.form.ports), opId),
      };
    case 'sweep':
      return {
        kind: 'sweep',
        data: await netscli.sweepNetwork(
          emptyToUndefined(tab.form.subnet),
          emptyToUndefined(tab.form.ports),
          opId,
          true,
          maxConcurrentProbes,
        ),
      };
    case 'mdns':
      return {
        kind: 'mdns',
        data: await netscli.discoverMdns(
          numberOrUndefined(tab.form.timeout_ms),
          serviceTypes(tab.form.service_types),
          opId,
        ),
      };
    case 'interfaces':
      return { kind: 'interfaces', data: await netscli.listInterfaces(opId) };
    case 'arp':
      return { kind: 'arp', data: await netscli.getArpTable(opId) };
    case 'pcap':
      if (tab.form.mode === 'Open File') {
        return {
          kind: 'pcap',
          data: await netscli.openPcapFile(boundedNumberOrUndefined(tab, 'max_packets')),
        };
      }
      return {
        kind: 'pcap',
        data: await netscli.capturePcap(
          {
            interface: tab.form.interface.trim(),
            duration: boundedNumberOrUndefined(tab, 'duration'),
            filter: emptyToUndefined(tab.form.filter),
            max_packets: boundedNumberOrUndefined(tab, 'max_packets'),
          },
          opId,
        ),
      };
  }
}

function boundedNumberOrUndefined(tab: WorkspaceTab, key: string): number | undefined {
  const parsed = numberOrUndefined(tab.form[key]);
  if (parsed === undefined) return undefined;
  const field = TOOL_CONFIG[tab.kind].fields.find((candidate) => candidate.key === key);
  if (!field) return parsed;

  const step = field.step ?? 1;
  const stepped = Number.isInteger(step) ? Math.trunc(parsed) : parsed;
  const lowerBounded = field.min === undefined ? stepped : Math.max(field.min, stepped);
  return field.max === undefined ? lowerBounded : Math.min(field.max, lowerBounded);
}

function serviceTypes(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

async function executeDns(tab: WorkspaceTab, opId: string): Promise<ToolResult> {
  const host = tab.form.host.trim();
  const record = tab.form.record?.trim().toUpperCase();

  if (record && record !== 'ALL') {
    return {
      kind: 'dns',
      data: await netscli.dnsLookup(host, record, opId),
    };
  }

  const data: DnsRecord[] = [];
  const failures: string[] = [];

  for (const recordType of DNS_ALL_RECORDS) {
    try {
      data.push(...await netscli.dnsLookup(host, recordType, opId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled/i.test(message)) throw error;
      failures.push(`${recordType}: ${message}`);
    }
  }

  if (data.length === 0 && failures.length > 0) {
    throw new Error(`DNS resolution failed: ${failures[0]}`);
  }

  return {
    kind: 'dns',
    data,
    warnings: failures.length > 0 ? [`Partial DNS results: no answers for ${failureRecordTypes(failures)}`] : undefined,
  };
}

function failureRecordTypes(failures: string[]): string {
  return failures.map((failure) => failure.split(':', 1)[0]).join(', ');
}

export function validateTab(tab: WorkspaceTab): string | null {
  if (tab.kind === 'pcap' && tab.form.mode === 'Open File') {
    return null;
  }
  const fields = TOOL_CONFIG[tab.kind].fields;
  const missing = fields.find((field) => field.required && !tab.form[field.key]?.trim());
  if (missing) return `${missing.label} is required`;

  // Shape, not just presence. Numeric fields are already bounded by their
  // `min`/`max`; the free-text ones were gated on presence alone, so
  // `ports: "hello"` was accepted here and only failed after a round trip to
  // the backend.
  for (const field of fields) {
    const value = tab.form[field.key];
    if (!value) continue;
    const problem = validateFieldValue(field.key, value);
    if (problem) return problem;
  }
  return null;
}
