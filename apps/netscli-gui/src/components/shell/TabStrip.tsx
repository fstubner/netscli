import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';

import { TOOL_CONFIG } from '../../tools/registry';
import { tabIdentity } from '../../tools/presentation';
import type { ToolCapabilityMap, ToolKind, WorkspaceTab } from '../../tools/types';
import { computePopoverPosition } from '../primitives/overlay';
import { handleTabStripKeyDown } from './tabStripKeyboard';
import { useTabStripDrag } from './useTabStripDrag';
import { tabDisplayFor } from './tabDisplay';
import { TabContextMenu, type TabContextTarget } from './TabContextMenu';
import { TabToolMenu } from './TabToolMenu';

interface TabStripProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  openMenu: string | null;
  toolCapabilities: ToolCapabilityMap;
  onAddScanTab: () => void;
  onAddToolTab: (kind: ToolKind) => void;
  onCloseTab: (tabId: string) => void;
  onCloseAllTabs: () => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseTabsBeside: (tabId: string, side: 'left' | 'right') => void;
  onSelectTab: (tabId: string) => void;
  setOpenMenu: (menu: string | null) => void;
}

export function TabStrip({
  tabs,
  activeTabId,
  openMenu,
  toolCapabilities,
  onAddScanTab,
  onAddToolTab,
  onCloseTab,
  onCloseAllTabs,
  onCloseOtherTabs,
  onCloseTabsBeside,
  onSelectTab,
  setOpenMenu,
}: TabStripProps) {
  const toolMenuOpen = openMenu === 'new-tab';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const chevronRef = useRef<HTMLButtonElement | null>(null);
  const { dragHandlers, suppressNextClick } = useTabStripDrag(scrollRef, () => {
    updateOverflowState();
    updateToolMenuPosition();
  });
  const [toolMenuPosition, setToolMenuPosition] = useState({ left: 0, maxHeight: 360, top: 0 });
  const [contextTarget, setContextTarget] = useState<TabContextTarget | null>(null);
  const [overflowState, setOverflowState] = useState({
    overflow: false,
    left: false,
    right: false,
  });
  const identities = tabs.map((tab) => tabIdentity(tab));

  const updateOverflowState = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const scrollLeft = Math.ceil(scroll.scrollLeft);
    setOverflowState({
      overflow: maxScrollLeft > 1,
      left: scrollLeft > 1,
      right: scrollLeft < maxScrollLeft - 1,
    });
  }, []);

  const updateToolMenuPosition = useCallback(() => {
    const trigger = chevronRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setToolMenuPosition(
      computePopoverPosition(rect, {
        align: 'end',
        height: 360,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        width: 220,
      }),
    );
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
      updateOverflowState();
      updateToolMenuPosition();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTabId, tabs.length, updateOverflowState, updateToolMenuPosition]);

  useEffect(() => {
    updateOverflowState();
    updateToolMenuPosition();
    window.addEventListener('resize', updateOverflowState);
    window.addEventListener('resize', updateToolMenuPosition);
    return () => {
      window.removeEventListener('resize', updateOverflowState);
      window.removeEventListener('resize', updateToolMenuPosition);
    };
  }, [tabs.length, updateOverflowState, updateToolMenuPosition]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    updateToolMenuPosition();
  }, [toolMenuOpen, updateToolMenuPosition]);

  return (
    <nav
      className={[
        'tab-strip',
        toolMenuOpen ? 'menu-open' : '',
        overflowState.overflow ? 'has-overflow' : '',
        overflowState.left ? 'has-left-overflow' : '',
        overflowState.right ? 'has-right-overflow' : '',
      ].filter(Boolean).join(' ')}
      data-testid="tab-strip"
    >
      <div
        className="tab-scroll"
        ref={scrollRef}
        {...dragHandlers}
        onScroll={() => {
          updateOverflowState();
          updateToolMenuPosition();
        }}
      >
        {/* Tablist semantics and roving tabindex — see tabStripKeyboard.ts. */}
        <div className="tab-list" role="tablist" aria-label="Open tools">
          {tabs.map((tab, index) => {
            const config = TOOL_CONFIG[tab.kind];
            const Icon = config.Icon;
            const { identity, identifier, tooltip } = tabDisplayFor(tab, index, identities);
            return (
              <div
                className={[
                  'work-tab',
                  tab.id === activeTabId ? 'active' : '',
                  tab.busy ? 'busy' : '',
                  !identifier ? 'no-identifier' : '',
                ].filter(Boolean).join(' ')}
                key={tab.id}
                ref={tab.id === activeTabId ? activeTabRef : undefined}
                role="tab"
                aria-selected={tab.id === activeTabId}
                aria-label={tooltip}
                tabIndex={tab.id === activeTabId ? 0 : -1}
                data-tooltip={tooltip}
                data-tooltip-placement="bottom"
                onClick={(event) => {
                  if (suppressNextClick.current) {
                    event.preventDefault();
                    suppressNextClick.current = false;
                    return;
                  }
                  onSelectTab(tab.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  // Select first: every item acts on this tab, and seeing it
                  // come forward as the menu opens is what makes that obvious.
                  onSelectTab(tab.id);
                  setContextTarget({
                    tabId: tab.id,
                    index,
                    total: tabs.length,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onKeyDown={(event) => handleTabStripKeyDown(event, index, tabs, onSelectTab, onCloseTab)}
              >
                <Icon size={14} />
                <span className="tab-identity">
                  <span className="tab-label">{identity.label}</span>
                  {identifier && <span className="tab-identifier">{identifier}</span>}
                </span>
                {tab.busy && <span className="tab-spinner" />}
                <button
                  className="tab-close"
                  aria-label={`Close ${identity.label} tab`}
                  data-tooltip="Close Tab"
                  data-tooltip-placement="bottom"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="add-tab-group">
        <button
          className="add-tab add-tab-main"
          aria-label="New port scan"
          data-tooltip="New Port Scan"
          data-tooltip-placement="bottom"
          onClick={() => {
            onAddScanTab();
            setOpenMenu(null);
          }}
        >
          <Plus size={16} />
        </button>
        <button
          className={`add-tab add-tab-chevron ${toolMenuOpen ? 'active' : ''}`}
          aria-label="Choose tool tab"
          data-tooltip="Choose Tool Tab"
          data-tooltip-placement="bottom"
          ref={chevronRef}
          onClick={() => {
            updateToolMenuPosition();
            setOpenMenu(toolMenuOpen ? null : 'new-tab');
          }}
        >
          <ChevronDown size={13} />
        </button>
      </div>
      {toolMenuOpen && (
        <TabToolMenu
          onAddToolTab={onAddToolTab}
          position={toolMenuPosition}
          setOpenMenu={setOpenMenu}
          toolCapabilities={toolCapabilities}
          triggerRef={chevronRef}
        />
      )}
      {contextTarget && (
        <TabContextMenu
          target={contextTarget}
          onClose={() => setContextTarget(null)}
          onCloseAll={onCloseAllTabs}
          onCloseBeside={onCloseTabsBeside}
          onCloseOthers={onCloseOtherTabs}
          onCloseTab={onCloseTab}
        />
      )}
    </nav>
  );
}
