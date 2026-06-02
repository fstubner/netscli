import { columnsFor } from './columns';
import { buildRows } from './rows';
import type { ResultColumn, ResultRow, ToolKind, WorkspaceTab } from '../types';

export interface FilterSectionConfig {
  label: string;
  options: Array<[string, string]>;
}

export interface FilterHints {
  placeholder: string;
  example: string;
  sections: FilterSectionConfig[];
}

const FIELD_KEY_LABELS: Record<string, string> = {
  ip: 'IP address',
  record_type: 'Record type',
  ips: 'Address',
  name: 'Interface',
  open_ports: 'Open ports',
  resolver: 'Resolver',
  ttl: 'TTL',
  app: 'App marker',
};

const FIELD_KEY_ALIASES: Record<string, string> = {
  banner: 'banner',
  app: 'app',
  duration: 'duration',
  file: 'file',
  hostname: 'hostname',
  interface: 'interface',
  ip: 'ip',
  ips: 'address',
  mac: 'mac',
  metric: 'metric',
  no: 'no',
  name: 'interface',
  open_ports: 'open_ports',
  packets: 'packets',
  port: 'port',
  ports: 'ports',
  proto: 'proto',
  protocol: 'protocol',
  record_type: 'type',
  service: 'service',
  source: 'source',
  state: 'state',
  status: 'status',
  destination: 'destination',
  info: 'info',
  kind: 'kind',
  length: 'length',
  time: 'time',
  ttl: 'ttl',
  value: 'value',
  resolver: 'resolver',
  vendor: 'vendor',
};

const SAMPLE_FIELDS: Record<ToolKind, string[]> = {
  scan: ['status', 'port', 'service', 'banner'],
  discover: ['ip', 'hostname', 'vendor', 'mac'],
  dns: ['record_type', 'value', 'resolver', 'ttl'],
  inspect: ['status', 'port', 'service', 'hostname'],
  sweep: ['ip', 'hostname', 'vendor', 'ports', 'mac'],
  interfaces: ['state', 'name', 'ips', 'kind'],
  arp: ['ip', 'interface', 'vendor', 'mac'],
  pcap: ['protocol', 'source', 'destination', 'info'],
};

export function filterHintsFor(tab: WorkspaceTab | undefined): FilterHints {
  if (!tab) {
    return {
      placeholder: 'filter results',
      example: 'field:value',
      sections: [],
    };
  }

  const rows = buildRows(tab.result);
  const columns = columnsFor(tab.kind, tab.result, rows);
  const sections = [
    ...commonSectionsFor(tab.kind, rows),
    fieldSection(columns, rows),
    ...resultValueSections(tab.kind, rows),
  ].filter((section) => section.options.length > 0);

  return {
    placeholder: placeholderFor(tab.kind),
    example: exampleFor(tab.kind),
    sections,
  };
}

function placeholderFor(kind: ToolKind): string {
  switch (kind) {
    case 'scan':
    case 'inspect':
      return 'filter results: status:open port:<number>';
    case 'dns':
      return 'filter results: type:A value:<text>';
    case 'discover':
    case 'sweep':
      return 'filter results: ip:<address> vendor:<name>';
    case 'interfaces':
      return 'filter results: state:up interface:<name>';
    case 'arp':
      return 'filter results: ip:<address> vendor:<name>';
    case 'pcap':
      return 'filter results: protocol:tcp source:<address>';
  }
}

function exampleFor(kind: ToolKind): string {
  switch (kind) {
    case 'scan':
    case 'inspect':
      return 'status:open';
    case 'dns':
      return 'type:A';
    case 'discover':
    case 'sweep':
      return 'ip:192.168';
    case 'interfaces':
      return 'state:up';
    case 'arp':
      return 'ip:192.168';
    case 'pcap':
      return 'protocol:tcp';
  }
}

function commonSectionsFor(kind: ToolKind, rows: ResultRow[]): FilterSectionConfig[] {
  switch (kind) {
    case 'scan':
    case 'inspect':
      return [
        {
          label: 'Status',
          options: [
            ['All rows', ''],
            ...valuesForField(rows, 'status').map((status) => [titleCase(status), `status:${status}`] as [string, string]),
            ...(rows.length === 0
              ? [
                  ['Open', 'status:open'],
                  ['Closed', 'status:closed'],
                  ['Filtered', 'status:filtered'],
                  ['Errors', 'status:error'],
                ] as Array<[string, string]>
              : []),
          ],
        },
      ];
    case 'dns': {
      const recordTypes = valuesForField(rows, 'record_type');
      return [
        {
          label: 'Record type',
          options: [
            ['All records', ''],
            ...(recordTypes.length > 0 ? recordTypes : ['A', 'AAAA', 'MX', 'TXT']).map(
              (recordType) => [`${recordType.toUpperCase()} records`, `type:${recordType.toUpperCase()}`] as [string, string],
            ),
          ],
        },
      ];
    }
    default:
      return [
        {
          label: 'Rows',
          options: [['All rows', '']],
        },
      ];
  }
}

function fieldSection(columns: ResultColumn[], rows: ResultRow[]): FilterSectionConfig {
  return {
    label: 'Fields',
    options: columns
      .filter((column) => rows.length === 0 || hasFieldData(rows, column.key))
      .map((column) => {
        const key = FIELD_KEY_ALIASES[column.key];
        if (!key) return null;
        return [FIELD_KEY_LABELS[column.key] ?? column.label, `${key}:`] as [string, string];
      })
      .filter((option): option is [string, string] => Boolean(option)),
  };
}

function hasFieldData(rows: ResultRow[], field: string): boolean {
  return valuesForField(rows, field).length > 0;
}

function resultValueSections(kind: ToolKind, rows: ResultRow[]): FilterSectionConfig[] {
  if (rows.length === 0) return [];

  const options: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const field of SAMPLE_FIELDS[kind]) {
    const key = FIELD_KEY_ALIASES[field] ?? field;
    for (const value of valuesForField(rows, field)) {
      const token = filterTokenValue(value);
      if (!token) continue;
      const optionValue = `${key}:${token}`;
      if (seen.has(optionValue)) continue;
      seen.add(optionValue);
      options.push([`${fieldLabel(field)}: ${shortLabel(value)}`, optionValue]);
      break;
    }
    if (options.length >= 5) break;
  }

  return options.length > 0
    ? [
        {
          label: 'Values in results',
          options,
        },
      ]
    : [];
}

function valuesForField(rows: ResultRow[], field: string): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row.data[field];
    const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
    if (!text || text === '-') continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(text);
  }
  return values;
}

function fieldLabel(field: string): string {
  return FIELD_KEY_LABELS[field] ?? titleCase(field.replace(/_/g, ' '));
}

function filterTokenValue(value: string): string | null {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text === '-') return null;
  if (/[\s:]/.test(text)) return `"${text.replace(/"/g, '')}"`;
  return text;
}

function shortLabel(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > 36 ? `${text.slice(0, 33)}...` : text;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
