import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';

import { TOOL_CONFIG } from '../../tools/registry';
import { tabIdentity } from '../../tools/presentation';
import type { ToolCapabilityMap, ToolKind, WorkspaceTab } from '../../tools/types';
import { computePopoverPosition } from '../primitives/overlay';
import { tabDisplayFor } from './tabDisplay';
import { TabToolMenu } from './TabToolMenu';

interface TabStripProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  openMenu: string | null;
  toolCapabilities: ToolCapabilityMap;
  onAddScanTab: () => void;
  onAddToolTab: (kind: ToolKind) => void;
  onCloseTab: (tabId: string) => void;
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
  onSelectTab,
  setOpenMenu,
}: TabStripProps) {
  const toolMenuOpen = openMenu === 'new-tab';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const chevronRef = useRef<HTMLButtonElement | null>(null);
  const dragState = useRef({
    active: false,
    captured: false,
    startX: 0,
    scrollLeft: 0,
    moved: false,
    pointerId: 0,
  });
  const suppressNextClick = useRef(false);
  const [toolMenuPosition, setToolMenuPosition] = useState({ left: 0, maxHeight: 360, top: 0 });
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
        onWheel={(event) => {
          const scroll = scrollRef.current;
          if (!scroll) return;
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          const unit =
            event.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? 16
              : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? scroll.clientWidth
                : 1;
          scroll.scrollBy({ left: event.deltaY * unit, behavior: 'smooth' });
          event.preventDefault();
          window.requestAnimationFrame(() => {
            updateOverflowState();
            updateToolMenuPosition();
          });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
          const scroll = scrollRef.current;
          if (!scroll || scroll.scrollWidth <= scroll.clientWidth + 1) return;
          dragState.current = {
            active: true,
            captured: false,
            startX: event.clientX,
            scrollLeft: scroll.scrollLeft,
            moved: false,
            pointerId: event.pointerId,
          };
        }}
        onPointerMove={(event) => {
          const state = dragState.current;
          const scroll = scrollRef.current;
          if (!state.active || !scroll) return;
          const delta = event.clientX - state.startX;
          if (Math.abs(delta) <= 6 && !state.moved) return;
          state.moved = true;
          if (!state.captured) {
            scroll.setPointerCapture(event.pointerId);
            state.captured = true;
          }
          scroll.scrollLeft = state.scrollLeft - delta;
          event.preventDefault();
          updateOverflowState();
          updateToolMenuPosition();
        }}
        onPointerUp={(event) => {
          const state = dragState.current;
          const moved = state.active && state.moved;
          if (state.captured && scrollRef.current?.hasPointerCapture(event.pointerId)) {
            scrollRef.current.releasePointerCapture(event.pointerId);
          }
          dragState.current = {
            active: false,
            captured: false,
            startX: 0,
            scrollLeft: 0,
            moved: false,
            pointerId: 0,
          };
          if (moved) {
            suppressNextClick.current = true;
            window.setTimeout(() => {
              suppressNextClick.current = false;
            }, 0);
          }
        }}
        onPointerCancel={(event) => {
          if (dragState.current.captured && scrollRef.current?.hasPointerCapture(event.pointerId)) {
            scrollRef.current.releasePointerCapture(event.pointerId);
          }
          dragState.current = {
            active: false,
            captured: false,
            startX: 0,
            scrollLeft: 0,
            moved: false,
            pointerId: 0,
          };
        }}
        onScroll={() => {
          updateOverflowState();
          updateToolMenuPosition();
        }}
      >
        <div className="tab-list">
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
                aria-label={tooltip}
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
    </nav>
  );
}
