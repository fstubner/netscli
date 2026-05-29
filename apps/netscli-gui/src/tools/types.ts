import type { LucideIcon } from 'lucide-react';

import type { ToolResult } from '../types/app';
import type { PortResult } from '../types/netscli';

export type ToolKind =
  | 'scan'
  | 'discover'
  | 'dns'
  | 'inspect'
  | 'sweep'
  | 'interfaces'
  | 'arp'
  | 'pcap';

export type DetailTab = 'details' | 'banner' | 'headers' | 'tls' | 'selection' | 'raw';
export type SortDir = 'asc' | 'desc';
export type RowSelectionMode = 'single' | 'toggle' | 'range' | 'focus';

export interface ToolField {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'select';
  options?: string[];
  required?: boolean;
  compact?: boolean;
}

export interface ToolConfig {
  label: string;
  shortLabel: string;
  Icon: LucideIcon;
  action: string;
  fields: ToolField[];
}

export interface WorkspaceTab {
  id: string;
  kind: ToolKind;
  title: string;
  form: Record<string, string>;
  result: ToolResult | null;
  error: string | null;
  busy: boolean;
  selectedIndex: number;
  selectedIndices: number[];
  selectionAnchor: number;
  detailTab: DetailTab;
  sortKey: string;
  sortDir: SortDir;
}

export interface ResultColumn {
  key: string;
  label: string;
  mono?: boolean;
  grow?: boolean;
  width?: number;
}

export type ResultCell = string | number | boolean | null | undefined;

export interface ResultRow {
  id: string;
  kind: ToolKind;
  data: Record<string, ResultCell>;
  raw: unknown;
  searchText: string;
  port?: PortResult;
}

export interface HistoryEntry {
  id: string;
  timestamp: Date;
  tabTitle: string;
  command: string;
  form: Record<string, string>;
  result: ToolResult;
}
