import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { buildRows } from '../../tools/presentation';
import { TOOL_CONFIG } from '../../tools/registry';
import type { HistoryEntry, ResultRow, WorkspaceTab } from '../../tools/types';
import { useModalFocus } from '../primitives/focus';

interface WorkspaceSearchDialogProps {
  history: HistoryEntry[];
  tabs: WorkspaceTab[];
  onClose: () => void;
  onOpenHistoryEntry: (entry: HistoryEntry) => void;
  onSelectRow: (tabId: string, rowId: string) => void;
  onSelectTab: (tabId: string) => void;
}

type SearchItem =
  | {
      id: string;
      kind: 'tab';
      primary: string;
      secondary: string;
      searchText: string;
      tabId: string;
    }
  | {
      id: string;
      kind: 'row';
      primary: string;
      secondary: string;
      searchText: string;
      rowId: string;
      tabId: string;
    }
  | {
      id: string;
      kind: 'history';
      primary: string;
      secondary: string;
      searchText: string;
      entry: HistoryEntry;
    };

export function WorkspaceSearchDialog({
  history,
  tabs,
  onClose,
  onOpenHistoryEntry,
  onSelectRow,
  onSelectTab,
}: WorkspaceSearchDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const items = useMemo(() => searchItemsFor(tabs, history), [history, tabs]);
  const matches = useMemo(() => filterItems(items, query).slice(0, 40), [items, query]);
  const activeItem = matches[Math.min(activeIndex, Math.max(0, matches.length - 1))];

  useModalFocus({ dialogRef, onClose });

  useEffect(() => {
    resultsRef.current
      ?.querySelector('button.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeIndex, matches.length]);

  function activate(item: SearchItem | undefined) {
    if (!item) return;
    if (item.kind === 'tab') {
      onSelectTab(item.tabId);
    } else if (item.kind === 'row') {
      onSelectRow(item.tabId, item.rowId);
    } else {
      onOpenHistoryEntry(item.entry);
    }
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(0, matches.length - 1)));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
        break;
      case 'PageDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 6, Math.max(0, matches.length - 1)));
        break;
      case 'PageUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 6));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(0, matches.length - 1));
        break;
      case 'Enter':
        event.preventDefault();
        activate(activeItem);
        break;
      default:
        break;
    }
  }

  return (
    <div className="search-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Workspace search"
        aria-modal="true"
        className="workspace-search"
        data-testid="workspace-search"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="workspace-search-input">
          <Search size={15} />
          <input
            aria-label="Search workspace"
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
            data-testid="workspace-search-input"
            placeholder="Search tabs, results, and history"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
          <button aria-label="Close search" data-tooltip="Close search" type="button" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="workspace-search-results" ref={resultsRef} role="listbox">
          {matches.length === 0 ? (
            <span className="workspace-search-empty">No workspace matches.</span>
          ) : (
            matches.map((item, index) => (
              <button
                aria-selected={item === activeItem}
                className={item === activeItem ? 'active' : ''}
                key={item.id}
                role="option"
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activate(item)}
              >
                <span className="workspace-search-kind">{labelForKind(item.kind)}</span>
                <span className="workspace-search-main">
                  <strong>{item.primary}</strong>
                  <small>{item.secondary}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function searchItemsFor(tabs: WorkspaceTab[], history: HistoryEntry[]): SearchItem[] {
  return [
    ...tabs.flatMap((tab) => tabItems(tab)),
    ...history.slice(0, 20).map((entry) => ({
      id: `history-${entry.id}`,
      kind: 'history' as const,
      primary: entry.command,
      secondary: `History - ${entry.tabTitle}`,
      searchText: `${entry.command} ${entry.tabTitle} ${JSON.stringify(entry.form)}`.toLowerCase(),
      entry,
    })),
  ];
}

function tabItems(tab: WorkspaceTab): SearchItem[] {
  const config = TOOL_CONFIG[tab.kind];
  const tabText = `${config.label} ${tab.title} ${Object.values(tab.form).join(' ')}`;
  const tabItem: SearchItem = {
    id: `tab-${tab.id}`,
    kind: 'tab',
    primary: `${config.label} tab`,
    secondary: tabTitle(tab),
    searchText: tabText.toLowerCase(),
    tabId: tab.id,
  };
  const rowItems = buildRows(tab.result).map((row) => rowItem(tab, row));
  return [tabItem, ...rowItems];
}

function rowItem(tab: WorkspaceTab, row: ResultRow): SearchItem {
  const config = TOOL_CONFIG[tab.kind];
  return {
    id: `row-${tab.id}-${row.id}`,
    kind: 'row',
    primary: rowTitle(row),
    secondary: `${config.label} - ${tabTitle(tab)}`,
    searchText: `${row.searchText} ${config.label} ${tab.title} ${Object.values(tab.form).join(' ')}`.toLowerCase(),
    rowId: row.id,
    tabId: tab.id,
  };
}

function filterItems(items: SearchItem[], query: string): SearchItem[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items.slice(0, 20);
  return items.filter((item) => tokens.every((token) => item.searchText.includes(token)));
}

function tabTitle(tab: WorkspaceTab): string {
  return Object.values(tab.form).filter(Boolean).join(' - ') || tab.title;
}

function rowTitle(row: ResultRow): string {
  const values = ['ip', 'host', 'hostname', 'port', 'service', 'vendor', 'record_type', 'value', 'protocol', 'destination']
    .map((key) => row.data[key])
    .filter((value) => value !== null && value !== undefined && value !== '');
  return values.length > 0 ? values.map(String).join(' - ') : row.searchText.slice(0, 80);
}

function labelForKind(kind: SearchItem['kind']): string {
  if (kind === 'tab') return 'Tab';
  if (kind === 'history') return 'History';
  return 'Result';
}
