import {
  ChevronDown,
  Clock,
  Copy,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FilePlus,
  PanelTopClose,
  History as HistoryIcon,
  Info,
  LogOut,
  Play,
  Square,
  SquareX,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import { LOOKUP_TOOL_KINDS, SCAN_TOOL_KINDS, TOOL_CONFIG } from '../../tools/registry';
import type { HistoryEntry, ToolKind, WorkspaceTab } from '../../tools/types';
import { NetsCliMenuMark } from './NetsCliMenuMark';

interface MenuItem {
  label: string;
  Icon: LucideIcon;
  action?: () => void;
  disabled?: boolean;
  selected?: boolean;
  variant?: 'danger';
}

interface MenuSection {
  label?: string;
  items: MenuItem[];
}

interface MenuBarProps {
  activeTab: WorkspaceTab | undefined;
  history: HistoryEntry[];
  openMenu: string | null;
  setOpenMenu: (menu: string | null) => void;
  tabCount: number;
  onAddTab: (kind: ToolKind) => void;
  onAbout: () => void;
  onOpenSettings: () => void;
  onCancelActive: () => void;
  onClearCurrentResults: () => void;
  onClearHistory: () => void;
  onCloseWindow: () => void;
  onCloseAllTabs: () => void;
  onCloseCurrentTab: () => void;
  onCloseOtherTabs: () => void;
  onCopyCommand: () => void;
  onCopySelectedDetails: () => void;
  onCopySelectedRaw: () => void;
  onExport: (format: 'json' | 'csv') => void;
  onExportSelectedJson: () => void;
  onExportSelectedCsv: () => void;
  onOpenHistoryEntry: (entry: HistoryEntry) => void;
  onRunActive: () => void;
}

export function MenuBar({
  activeTab,
  history,
  openMenu,
  setOpenMenu,
  tabCount,
  onAddTab,
  onAbout,
  onOpenSettings,
  onCancelActive,
  onClearCurrentResults,
  onClearHistory,
  onCloseWindow,
  onCloseAllTabs,
  onCloseCurrentTab,
  onCloseOtherTabs,
  onCopyCommand,
  onCopySelectedDetails,
  onCopySelectedRaw,
  onExport,
  onExportSelectedJson,
  onExportSelectedCsv,
  onOpenHistoryEntry,
  onRunActive,
}: MenuBarProps) {
  const [popoverPosition, setPopoverPosition] = useState({ left: 0, top: 34 });

  const makeToolItem = (kind: ToolKind): MenuItem => ({
    label: TOOL_CONFIG[kind].label,
    Icon: TOOL_CONFIG[kind].Icon,
    action: () => onAddTab(kind),
  });

  const groups: Array<{ label: string; sections: MenuSection[] }> = [
    {
      label: 'File',
      sections: [
        {
          items: [
            { label: 'New Port Scan', Icon: FilePlus, action: () => onAddTab('scan') },
            { label: 'Close Current Tab', Icon: X, action: onCloseCurrentTab, disabled: !activeTab },
            {
              label: 'Close Other Tabs',
              Icon: PanelTopClose,
              action: onCloseOtherTabs,
              disabled: !activeTab || tabCount <= 1,
            },
            { label: 'Close All Tabs', Icon: SquareX, action: onCloseAllTabs, disabled: tabCount === 0 },
            { label: 'Export JSON', Icon: Download, action: () => onExport('json'), disabled: !activeTab?.result },
            { label: 'Export CSV', Icon: Download, action: () => onExport('csv'), disabled: !activeTab?.result },
          ],
        },
        {
          items: [{ label: 'Exit', Icon: LogOut, action: onCloseWindow, variant: 'danger' }],
        },
      ],
    },
    {
      label: 'Edit',
      sections: [
        {
          items: [
            { label: 'Copy CLI Command', Icon: Copy, action: onCopyCommand, disabled: !activeTab },
            {
              label: 'Copy Selected Details',
              Icon: ClipboardList,
              action: onCopySelectedDetails,
              disabled: !activeTab?.result,
            },
            {
              label: 'Copy Selected Raw',
              Icon: Copy,
              action: onCopySelectedRaw,
              disabled: !activeTab?.result,
            },
            {
              label: 'Export Selected JSON',
              Icon: Download,
              action: onExportSelectedJson,
              disabled: !activeTab?.result,
            },
            {
              label: 'Export Selected CSV',
              Icon: FileSpreadsheet,
              action: onExportSelectedCsv,
              disabled: !activeTab?.result,
            },
            {
              label: 'Clear Current Results',
              Icon: Trash2,
              action: onClearCurrentResults,
              disabled: !activeTab || (!activeTab.result && !activeTab.error),
            },
          ],
        },
      ],
    },
    {
      label: 'Scan',
      sections: [
        {
          items: [
            { label: 'Run Active Tab', Icon: Play, action: onRunActive, disabled: !activeTab || activeTab.busy },
            { label: 'Cancel Active Tab', Icon: Square, action: onCancelActive, disabled: !activeTab?.busy },
          ],
        },
        {
          label: 'Operations',
          items: SCAN_TOOL_KINDS.map(makeToolItem),
        },
      ],
    },
    {
      label: 'Tools',
      sections: [
        {
          label: 'Tools and Inventory',
          items: LOOKUP_TOOL_KINDS.map(makeToolItem),
        },
      ],
    },
    {
      label: 'History',
      sections: [
        {
          label: 'Recent Runs',
          items:
            history.length > 0
              ? history.slice(0, 8).map((entry) => ({
                  label: historyMenuLabel(entry),
                  Icon: HistoryIcon,
                  action: () => onOpenHistoryEntry(entry),
                }))
              : [{ label: 'No recent runs', Icon: Clock, disabled: true }],
        },
        {
          items: [
            {
              label: 'Clear History',
              Icon: Trash2,
              action: onClearHistory,
              disabled: history.length === 0,
            },
          ],
        },
      ],
    },
    {
      label: 'Settings',
      sections: [
        {
          items: [
            {
              label: 'Open Settings',
              Icon: Info,
              action: onOpenSettings,
            },
          ],
        },
      ],
    },
    {
      label: 'Help',
      sections: [
        {
          items: [
            {
              label: 'About NetsCLI',
              Icon: Info,
              action: onAbout,
            },
          ],
        },
      ],
    },
  ];

  return (
    <div className="menu-strip">
      <NetsCliMenuMark />
      {groups.map((group) => (
        <div className="menu-root" key={group.label}>
          <button
            className={`menu-button ${openMenu === group.label ? 'active' : ''}`}
            onClick={(event) => {
              if (group.label === 'Settings') {
                setOpenMenu(null);
                onOpenSettings();
                return;
              }
              if (openMenu !== group.label) {
                const rect = event.currentTarget.getBoundingClientRect();
                const width = 220;
                setPopoverPosition({
                  left: Math.max(6, Math.min(rect.left, window.innerWidth - width - 8)),
                  top: rect.bottom,
                });
              }
              setOpenMenu(openMenu === group.label ? null : group.label);
            }}
          >
            <span>{group.label}</span>
            {group.label !== 'Settings' && <ChevronDown size={10} />}
          </button>
          {openMenu === group.label &&
            group.label !== 'Settings' && (
            <div
              className={`menu-popover ${group.label === 'History' ? 'history-popover' : ''}`}
              style={{ left: popoverPosition.left, top: popoverPosition.top }}
            >
              {group.sections.map((section, sectionIndex) => (
                <div className="menu-popover-section" key={section.label ?? sectionIndex}>
                  {section.label && <span className="menu-popover-label">{section.label}</span>}
                  {section.items.map((item) => (
                    <button
                      className={[
                        'menu-popover-item',
                        item.selected ? 'selected' : '',
                        item.variant === 'danger' ? 'danger' : '',
                      ].filter(Boolean).join(' ')}
                      disabled={item.disabled}
                      key={item.label}
                      onClick={() => {
                        item.action?.();
                        setOpenMenu(null);
                      }}
                    >
                      <item.Icon size={14} />
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function historyMenuLabel(entry: HistoryEntry): string {
  const time = entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const command = entry.command.replace(/\s+--json$/, '');
  return `${time}  ${command}`;
}
