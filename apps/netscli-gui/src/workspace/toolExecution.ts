import { isTauri } from '../services/env';
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

export async function executeTool(tab: WorkspaceTab, opId: string): Promise<ToolResult> {
  if (!isTauri()) {
    throw new Error("Tauri backend not available. Run 'npm run tauri dev' to execute tools.");
  }

  switch (tab.kind) {
    case 'scan':
      return {
        kind: 'scan',
        data: await netscli.scanPorts(tab.form.host.trim(), emptyToUndefined(tab.form.ports), opId),
      };
    case 'discover':
      return {
        kind: 'discover',
        data: await netscli.discoverNetwork(emptyToUndefined(tab.form.subnet), opId, true),
      };
    case 'dns':
      return executeDns(tab, opId);
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
        ),
      };
    case 'interfaces':
      return { kind: 'interfaces', data: await netscli.listInterfaces(opId) };
    case 'arp':
      return { kind: 'arp', data: await netscli.getArpTable(opId) };
    case 'pcap':
      return {
        kind: 'pcap',
        data: await netscli.capturePcap(
          {
            interface: tab.form.interface.trim(),
            duration: numberOrUndefined(tab.form.duration),
            filter: emptyToUndefined(tab.form.filter),
            max_packets: numberOrUndefined(tab.form.max_packets),
            output_mode: captureOutputMode(tab.form.output_mode),
          },
          opId,
        ),
      };
  }
}

function captureOutputMode(value: string | undefined): string {
  return value?.trim().toLowerCase() === 'ask' ? 'ask' : 'auto';
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
    warnings: failures.length > 0 ? [`Some DNS record lookups failed: ${failureRecordTypes(failures)}`] : undefined,
  };
}

function failureRecordTypes(failures: string[]): string {
  return failures.map((failure) => failure.split(':', 1)[0]).join(', ');
}

export function validateTab(tab: WorkspaceTab): string | null {
  const missing = TOOL_CONFIG[tab.kind].fields.find(
    (field) => field.required && !tab.form[field.key]?.trim(),
  );
  if (missing) return `${missing.label} is required`;
  return null;
}
