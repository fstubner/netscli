import {
  ChevronDown,
  Clock,
  Copy,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FilePlus,
  FolderOpen,
  PanelTopClose,
  History as HistoryIcon,
  Info,
  LogOut,
  Play,
  Save,
  Square,
  SquareX,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

import { availableToolKinds, LOOKUP_TOOL_KINDS, SCAN_TOOL_KINDS, TOOL_CONFIG } from '../../tools/registry';
import type { HistoryEntry, ToolCapabilityMap, ToolKind, WorkspaceTab } from '../../tools/types';
import { useRovingFocus } from '../primitives/focus';
import { useAnchoredPopoverPosition, useOverlayDismiss } from '../primitives/overlay';
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

const MENU_POPOVER_LABELS = new Set(['File', 'Edit', 'Scan', 'Tools', 'History', 'Help']);

interface MenuBarProps {
  activeTab: WorkspaceTab | undefined;
  history: HistoryEntry[];
  openMenu: string | null;
  setOpenMenu: (menu: string | null) => void;
  tabCount: number;
  toolCapabilities: ToolCapabilityMap;
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
  onOpenResultBundle: () => void;
  onSaveResultBundle: () => void;
  onOpenHistoryEntry: (entry: HistoryEntry) => void;
  onRunActive: () => void;
  runDisabledReason?: string;
}

export function MenuBar({
  activeTab,
  history,
  openMenu,
  setOpenMenu,
  tabCount,
  toolCapabilities,
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
  onOpenResultBundle,
  onSaveResultBundle,
  onOpenHistoryEntry,
  onRunActive,
  runDisabledReason,
}: MenuBarProps) {
  const menuPopoverOpen = openMenu !== null && MENU_POPOVER_LABELS.has(openMenu);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const popoverPosition = useAnchoredPopoverPosition({
    anchorRef: activeButtonRef,
    estimatedHeight: 300,
    open: menuPopoverOpen,
    panelRef: popoverRef,
    positionKey: openMenu,
    width: openMenu === 'History' ? 320 : 220,
  });
  const closeMenu = () => {
    const openLabel = openMenu;
    lastTriggerRef.current =
      activeButtonRef.current ??
      Array.from(document.querySelectorAll<HTMLButtonElement>('.menu-button')).find(
        (button) => button.textContent.trim() === openLabel,
      ) ??
      null;
    shouldRestoreFocusRef.current = true;
    lastTriggerRef.current?.focus({ preventScroll: true });
    setOpenMenu(null);
  };
  const onMenuKeyDown = useRovingFocus({
    containerRef: popoverRef,
    enabled: menuPopoverOpen,
    itemSelector: '.menu-popover-item:not(:disabled)',
    onClose: closeMenu,
  });

  useOverlayDismiss({
    enabled: menuPopoverOpen,
    onClose: closeMenu,
    refs: [activeButtonRef, popoverRef],
    restoreFocusRef: activeButtonRef,
  });

  useEffect(() => {
    if (menuPopoverOpen || !shouldRestoreFocusRef.current) return;
    shouldRestoreFocusRef.current = false;
    window.requestAnimationFrame(() => lastTriggerRef.current?.focus({ preventScroll: true }));
    window.setTimeout(() => lastTriggerRef.current?.focus({ preventScroll: true }), 50);
  }, [menuPopoverOpen]);

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
            { label: 'Open Result Bundle', Icon: FolderOpen, action: onOpenResultBundle },
            { label: 'Save Result Bundle', Icon: Save, action: onSaveResultBundle, disabled: !activeTab?.result },
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
            { label: 'Run Active Tab', Icon: Play, action: onRunActive, disabled: !activeTab || activeTab.busy || Boolean(runDisabledReason) },
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
          items: availableToolKinds(LOOKUP_TOOL_KINDS, toolCapabilities).map(makeToolItem),
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
            aria-expanded={group.label !== 'Settings' ? openMenu === group.label : undefined}
            aria-haspopup={group.label !== 'Settings' ? 'menu' : undefined}
            className={`menu-button ${openMenu === group.label ? 'active' : ''}`}
            ref={openMenu === group.label ? activeButtonRef : undefined}
            onClick={(event) => {
              if (group.label === 'Settings') {
                setOpenMenu(null);
                onOpenSettings();
                return;
              }
              lastTriggerRef.current = event.currentTarget;
              setOpenMenu(openMenu === group.label ? null : group.label);
            }}
            onMouseEnter={(event) => {
              if (!menuPopoverOpen || openMenu === group.label) return;
              lastTriggerRef.current = event.currentTarget;
              shouldRestoreFocusRef.current = false;
              if (group.label === 'Settings') {
                setOpenMenu(null);
                return;
              }
              setOpenMenu(group.label);
            }}
            onKeyDown={(event) => {
              if (group.label === 'Settings') return;
              if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                lastTriggerRef.current = event.currentTarget;
                setOpenMenu(group.label);
              }
            }}
          >
            <span>{group.label}</span>
            {group.label !== 'Settings' && <ChevronDown size={10} />}
          </button>
          {openMenu === group.label &&
            group.label !== 'Settings' && (
            <div
              className={`menu-popover ${group.label === 'History' ? 'history-popover' : ''}`}
              ref={popoverRef}
              role="menu"
              style={{ left: popoverPosition.left, maxHeight: popoverPosition.maxHeight, top: popoverPosition.top }}
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
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
                      role="menuitem"
                      onClick={() => {
                        shouldRestoreFocusRef.current = false;
                        item.action?.();
                        setOpenMenu(null);
                      }}
                    >
                      <item.Icon size={14} />
                      <span className="menu-popover-item-label">{item.label}</span>
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
