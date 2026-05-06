import { useEffect, useRef, useState } from 'react';

import './App.css';

import { Banner } from './components/Banner';
import { TitleBar } from './components/TitleBar';
import {
  DashboardIcon,
  DnsIcon,
  DiscoverIcon,
  InspectIcon,
  InterfacesIcon,
  PcapIcon,
  ScanIcon,
  SettingsIcon,
  SweepIcon,
} from './components/Icons';

import { isTauri } from './services/env';
import * as netscli from './services/netscli';

// Lazy-import Tauri window API only on desktop so the browser-dev build
// doesn't choke on missing platform bindings.
async function closeAppWindow() {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch {
    // If the import fails for any reason, fall through — there's nothing
    // meaningful we can do, and window.close() in Tauri doesn't work for
    // windows the renderer didn't open itself.
  }
}

function openHelpModal(kind: 'docs' | 'shortcuts' | 'about') {
  // Menu items previously had `action: () => {}` — clicking them did
  // nothing and gave no feedback. Keep the UX discoverable by showing
  // a simple alert until a proper modal lands.
  const messages: Record<typeof kind, string> = {
    docs: 'Documentation: https://github.com/fstubner/netscli',
    shortcuts:
      'Keyboard shortcuts:\n\nCtrl+1-9  Switch tabs\nCtrl+E    Export results\nCtrl+D    Toggle dark mode\nCtrl+,    Preferences',
    about: 'NetsCLI — a modern network scanner.\nhttps://github.com/fstubner/netscli',
  };
  // eslint-disable-next-line no-alert
  window.alert(messages[kind]);
}

import type { HistoryEntry, Tab, TabViewMode, ToolParams, ToolResult } from './types/app';
import type { DefaultInterfaceInfo, InterfaceInfo, NetworkStats } from './types/netscli';

import { DashboardView } from './views/DashboardView';
import { DiscoverToolbar, DiscoverResults } from './views/DiscoverView';
import { DnsToolbar, DnsResults } from './views/DnsView';
import { InspectToolbar, InspectResults } from './views/InspectView';
import { ArpResults, InterfacesToolbar, InterfacesResults } from './views/InterfacesView';
import { PcapToolbar, PcapResults, pcapGuidance } from './views/PcapView';
import { ScanToolbar, ScanResults } from './views/ScanView';
import { SettingsView } from './views/SettingsView';
import { SweepToolbar, SweepResults } from './views/SweepView';

// Vite injects this at build time from package.json — see vite.config.ts.
// Keeps the in-app version display (status bar, About dialog) in sync
// with package.json / tauri.conf.json automatically. Was hardcoded
// '0.1.0' until v0.2.6, which a Winget moderator caught.
const APP_VERSION = __APP_VERSION__;

type DnsRecordType = 'A' | 'AAAA';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  // Per-tab state (outputs, errors, busy flags survive tab switching)
  const [tabOutputs, setTabOutputs] = useState<Partial<Record<Tab, ToolResult | null>>>({});
  const [tabErrors, setTabErrors] = useState<Partial<Record<Tab, string | null>>>({});
  const [tabBusy, setTabBusy] = useState<Partial<Record<Tab, boolean>>>({});
  const [tabViewMode, setTabViewMode] = useState<Partial<Record<Tab, TabViewMode>>>({});

  // Derived values for current tab (minimizes changes to downstream code)
  const output = tabOutputs[activeTab] ?? null;
  const error = tabErrors[activeTab] ?? null;
  const busy = tabBusy[activeTab] ?? false;
  const viewMode = tabViewMode[activeTab] ?? 'results';

  // Form states
  const [subnet, setSubnet] = useState('');
  const [host, setHost] = useState('');
  const [ports, setPorts] = useState('');
  const [dnsType, setDnsType] = useState<DnsRecordType>('A');
  const [pcapInterface, setPcapInterface] = useState('');
  const [pcapDuration, setPcapDuration] = useState('5');
  const [validationErrors, setValidationErrors] = useState<Record<string, string | null>>({});

  // Network stats
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [defaultInterface, setDefaultInterface] = useState<DefaultInterfaceInfo | null>(null);
  const [allInterfaces, setAllInterfaces] = useState<InterfaceInfo[]>([]);

  const [darkMode, setDarkMode] = useState(true);
  const [scanHistory, setScanHistory] = useState<HistoryEntry[]>([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  // Tracks which history entry ID is currently displayed per tab (for highlight in history list)
  const [tabActiveHistoryId, setTabActiveHistoryId] = useState<Partial<Record<Tab, string>>>({});

  const toolSelectorRef = useRef<HTMLDivElement>(null);
  // Per-tab monotonic sequence so a newer op on tab A doesn't stomp an
  // older op on tab B. Previously a single global `opSeq` caused any
  // later op to invalidate every in-flight op on every tab, leaving
  // older tabs stuck in the "busy" spinner state forever.
  const opSeqByTab = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);
  const currentOpId = useRef<string | null>(null);
  const currentOpTab = useRef<Tab | null>(null);

  // `validateRequired` was previously used inline by renderToolbar's
  // case branches. After lifting per-tab toolbars into views/*View.tsx,
  // each view runs its own inline validation against its own form
  // state, so the helper is no longer needed here.

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Invalidate every in-flight op so their callbacks become no-ops.
      for (const k of Object.keys(opSeqByTab.current)) {
        opSeqByTab.current[k] += 1;
      }
    };
  }, []);

  const cancelOperation = () => {
    const op_id = currentOpId.current;
    const opTab = currentOpTab.current;
    currentOpId.current = null;
    currentOpTab.current = null;

    // Invalidate only the op on the tab being cancelled so other tabs'
    // in-flight work isn't affected.
    if (opTab) {
      opSeqByTab.current[opTab] = (opSeqByTab.current[opTab] ?? 0) + 1;
      setTabBusy((prev) => ({ ...prev, [opTab]: false }));
      setTabErrors((prev) => ({ ...prev, [opTab]: 'Operation cancelled' }));
    }

    if (op_id && isTauri()) {
      void netscli.cancelOperation(op_id).catch(() => {});
    }
  };

  /**
   * Run an async tool operation scoped to a single tab.
   *
   * Sequence numbers are per-tab so concurrent ops on different tabs no
   * longer cross-invalidate each other. The busy-state reset is
   * unconditional: even if a newer op has superseded this one we still
   * clear the spinner on the tab this promise ran for, so a stale-result
   * drop never leaves the UI stuck.
   *
   * On environments without Tauri (pure `vite dev` in a browser), we set
   * an error instead of throwing — the caller uses `void runOperation(...)`
   * and an unhandled rejection would be invisible to the user.
   */
  function generateOpId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function runOperation(
    tab: Tab,
    params: ToolParams,
    exec: (op_id: string) => Promise<ToolResult>,
  ) {
    if (!isTauri()) {
      setTabErrors((prev) => ({
        ...prev,
        [tab]: "Tauri backend not available. Run 'npm run tauri dev' to start the full application.",
      }));
      setTabBusy((prev) => ({ ...prev, [tab]: false }));
      return;
    }

    const op_id = generateOpId();
    currentOpId.current = op_id;
    currentOpTab.current = tab;

    const mySeq = (opSeqByTab.current[tab] = (opSeqByTab.current[tab] ?? 0) + 1);

    setTabBusy((prev) => ({ ...prev, [tab]: true }));
    setTabErrors((prev) => ({ ...prev, [tab]: null }));
    setTabOutputs((prev) => ({ ...prev, [tab]: null }));
    setTabActiveHistoryId((prev) => ({ ...prev, [tab]: undefined }));

    const isStillCurrent = () =>
      mountedRef.current && opSeqByTab.current[tab] === mySeq;

    try {
      const result = await exec(op_id);

      if (!isStillCurrent()) return;

      setTabOutputs((prev) => ({ ...prev, [tab]: result }));
      setTabViewMode((prev) => ({ ...prev, [tab]: 'results' }));

      const historyEntry: HistoryEntry = {
        id: generateOpId(),
        tab,
        timestamp: new Date(),
        params,
        result,
      };

      setTabActiveHistoryId((prev) => ({ ...prev, [tab]: historyEntry.id }));
      setScanHistory((prev) => [historyEntry, ...prev].slice(0, 50));
    } catch (e: unknown) {
      if (!isStillCurrent()) return;

      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('Tauri API') || errorMsg.includes('invoke')) {
        setTabErrors((prev) => ({
          ...prev,
          [tab]: "Backend not available. Please run 'npm run tauri dev' to start the full application.",
        }));
      } else {
        setTabErrors((prev) => ({ ...prev, [tab]: errorMsg }));
      }
    } finally {
      // Unconditional cleanup: even if this op was superseded by a newer
      // one on the same tab, we still clear the spinner so the UI never
      // hangs on a stale-result drop. The caller's refs only reflect the
      // most recently started op, so only null them if they still point
      // at us.
      if (currentOpId.current === op_id) {
        currentOpId.current = null;
        currentOpTab.current = null;
      }
      setTabBusy((prev) => {
        // Only clear busy if we're still the current op; a newer op may
        // already have re-set it to true and that state must win.
        if (opSeqByTab.current[tab] !== mySeq) return prev;
        return { ...prev, [tab]: false };
      });
    }
  }

  // Load network stats and default interface — only poll while the
  // Dashboard is visible. Previously this ran every 2s for the app's
  // lifetime across every tab, contending with in-flight scans.
  useEffect(() => {
    if (!isTauri()) return;
    if (activeTab !== 'dashboard') return;

    let cancelled = false;
    let inFlight = false;

    const loadNetworkInfo = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [stats, iface, interfaces] = await Promise.all([
          netscli.getNetworkStats().catch(() => null),
          netscli.getDefaultInterface().catch(() => null),
          netscli.listInterfaces().catch(() => null),
        ]);

        if (cancelled) return;

        if (stats) setNetworkStats(stats);
        if (iface) setDefaultInterface(iface);
        if (interfaces) setAllInterfaces(interfaces);
      } finally {
        inFlight = false;
      }
    };

    void loadNetworkInfo();
    const interval = window.setInterval(loadNetworkInfo, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeTab]);

  // Enable horizontal scrolling with mouse wheel on tool selector
  useEffect(() => {
    const toolSelector = toolSelectorRef.current;
    if (!toolSelector) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        toolSelector.scrollLeft += e.deltaY;
      }
    };

    toolSelector.addEventListener('wheel', handleWheel, { passive: false });
    return () => toolSelector.removeEventListener('wheel', handleWheel);
  }, []);

  const exportResults = (format: 'json' | 'csv') => {
    if (!output) return;

    const data = output.data;

    let content = '';
    let filename = '';
    let mimeType = '';

    if (format === 'json') {
      content = JSON.stringify(data, null, 2);
      filename = `netscli-${output.kind}-${Date.now()}.json`;
      mimeType = 'application/json';
    } else {
      if (!Array.isArray(data) || data.length === 0) {
        return;
      }

      const firstItem = data[0];
      if (typeof firstItem === 'object' && firstItem !== null) {
        const firstObj = firstItem as unknown as Record<string, unknown>;
        const headers = Object.keys(firstObj).join(',');
        const rows = data.map((item) => {
          const obj = (item ?? {}) as unknown as Record<string, unknown>;
          return Object.values(obj)
            .map((val) => {
              if (typeof val === 'string' && val.includes(',')) {
                return `"${val}"`;
              }
              return String(val ?? '');
            })
            .join(',');
        });
        content = [headers, ...rows].join('\n');
      } else {
        content = data.map((v) => String(v)).join('\n');
      }

      filename = `netscli-${output.kind}-${Date.now()}.csv`;
      mimeType = 'text/csv';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportSelectedHistory = () => {
    if (selectedHistoryIds.size === 0) return;

    const selected = scanHistory.filter((e) => selectedHistoryIds.has(e.id));
    if (selected.length === 0) return;

    const exportData = selected.map((entry) => ({
      tab: entry.tab,
      timestamp: entry.timestamp.toISOString(),
      params: entry.params,
      result: entry.result,
    }));

    const content = JSON.stringify(exportData, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netscli-history-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSelectedHistoryIds(new Set());
  };

  const renderToolbar = () => {
    if (activeTab === 'dashboard' || activeTab === 'settings') return null;

    // Bind the per-tab `runOperation` so the view components don't
    // need to know about the active tab — they only see a callback
    // that takes the params + exec they already constructed.
    const onRunCurrent = (
      params: ToolParams,
      exec: (op_id: string) => Promise<ToolResult>,
    ) => {
      void runOperation(activeTab, params, exec);
    };

    switch (activeTab) {
      case 'discover':
        return (
          <DiscoverToolbar
            busy={busy}
            subnet={subnet}
            setSubnet={setSubnet}
            onRun={onRunCurrent}
            onCancel={cancelOperation}
          />
        );
      case 'scan':
        return (
          <ScanToolbar
            busy={busy}
            host={host}
            setHost={setHost}
            ports={ports}
            setPorts={setPorts}
            validationErrors={validationErrors}
            setValidationErrors={setValidationErrors}
            onRun={onRunCurrent}
            onCancel={cancelOperation}
          />
        );
      case 'inspect':
        return (
          <InspectToolbar
            busy={busy}
            host={host}
            setHost={setHost}
            ports={ports}
            setPorts={setPorts}
            validationErrors={validationErrors}
            setValidationErrors={setValidationErrors}
            onRun={onRunCurrent}
            onCancel={cancelOperation}
          />
        );
      case 'sweep':
        return (
          <SweepToolbar
            busy={busy}
            subnet={subnet}
            setSubnet={setSubnet}
            ports={ports}
            setPorts={setPorts}
            onRun={onRunCurrent}
            onCancel={cancelOperation}
          />
        );
      case 'dns':
        return (
          <DnsToolbar
            busy={busy}
            host={host}
            setHost={setHost}
            dnsType={dnsType}
            setDnsType={setDnsType}
            validationErrors={validationErrors}
            setValidationErrors={setValidationErrors}
            onRun={onRunCurrent}
            onCancel={cancelOperation}
          />
        );
      case 'interfaces':
        return (
          <InterfacesToolbar
            busy={busy}
            onRun={onRunCurrent}
            onCancel={cancelOperation}
          />
        );
      case 'pcap':
        return (
          <PcapToolbar
            busy={busy}
            pcapInterface={pcapInterface}
            setPcapInterface={setPcapInterface}
            pcapDuration={pcapDuration}
            setPcapDuration={setPcapDuration}
            validationErrors={validationErrors}
            setValidationErrors={setValidationErrors}
            error={error}
            onRun={onRunCurrent}
            onCancel={cancelOperation}
          />
        );
      default:
        return null;
    }
  };

  const formatParamsShort = (params: ToolParams): string => {
    switch (params.kind) {
      case 'discover':
        return params.subnet ?? 'auto-detect';
      case 'scan':
      case 'inspect':
        return `${params.host}${params.ports ? ` : ${params.ports}` : ''}`;
      case 'sweep':
        return `${params.subnet ?? 'auto'}${params.ports ? ` : ${params.ports}` : ''}`;
      case 'dns':
        return `${params.host} (${params.record})`;
      case 'interfaces':
        return 'interfaces';
      case 'arp':
        return 'ARP table';
      case 'pcap':
        return `${params.interface || 'any'} · ${params.duration ?? 5}s`;
    }
  };

  const tabHistory = scanHistory.filter((e) => e.tab === activeTab);

  const renderHistoryList = () => {
    if (tabHistory.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state-text">No scan history for this tab yet.</div>
        </div>
      );
    }

    return (
      <div className="tab-history-list">
        {tabHistory.map((entry) => (
          <div
            key={entry.id}
            className={`tab-history-item ${tabActiveHistoryId[activeTab] === entry.id ? 'active' : ''}`}
          >
            <input
              type="checkbox"
              className="history-checkbox"
              checked={selectedHistoryIds.has(entry.id)}
              onChange={(e) => {
                setSelectedHistoryIds((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) {
                    next.add(entry.id);
                  } else {
                    next.delete(entry.id);
                  }
                  return next;
                });
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <div
              className="tab-history-item-content"
              onClick={() => {
                setTabOutputs((prev) => ({ ...prev, [activeTab]: entry.result }));
                setTabActiveHistoryId((prev) => ({ ...prev, [activeTab]: entry.id }));
                setTabViewMode((prev) => ({ ...prev, [activeTab]: 'results' }));
              }}
            >
              <div className="tab-history-item-time">
                {entry.timestamp.toLocaleTimeString()}
              </div>
              <div className="tab-history-item-params">{formatParamsShort(entry.params)}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderContent = () => {
    if (activeTab === 'dashboard') {
      return (
        <DashboardView
          defaultInterface={defaultInterface}
          networkStats={networkStats}
          allInterfaces={allInterfaces}
          scanHistory={scanHistory}
          onSelectHistory={(entry) => {
            setTabOutputs((prev) => ({ ...prev, [entry.tab]: entry.result }));
            setTabActiveHistoryId((prev) => ({ ...prev, [entry.tab]: entry.id }));
            setTabViewMode((prev) => ({ ...prev, [entry.tab]: 'results' }));
            setActiveTab(entry.tab);
          }}
        />
      );
    }

    if (activeTab === 'settings') {
      return <SettingsView darkMode={darkMode} onDarkModeChange={setDarkMode} version={APP_VERSION} />;
    }

    if (!output) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">
            <DiscoverIcon size={64} color="#00a86b" />
          </div>
          <div className="empty-state-text">No results yet. Start a scan to see results here.</div>
        </div>
      );
    }

    // Dispatch on output.kind so each result renderer is purely a
    // function of its data shape, with no cross-talk between tabs.
    switch (output.kind) {
      case 'discover':
        return <DiscoverResults data={output.data} />;
      case 'scan':
        return <ScanResults data={output.data} />;
      case 'inspect':
        return <InspectResults data={output.data} />;
      case 'sweep':
        return <SweepResults data={output.data} />;
      case 'dns':
        return <DnsResults data={output.data} />;
      case 'interfaces':
        return <InterfacesResults data={output.data} />;
      case 'arp':
        return <ArpResults data={output.data} />;
      case 'pcap':
        return <PcapResults data={output.data} />;
      default:
        return null;
    }
  };

  const getResultCount = () => {
    if (!output) return 0;
    if (!Array.isArray(output.data)) return 0;
    return output.data.length;
  };

  const getPageTitle = () => {
    const titles: Record<Tab, string> = {
      dashboard: 'Dashboard',
      discover: 'Network Discovery',
      scan: 'Port Scanner',
      inspect: 'Host Inspector',
      sweep: 'Network Sweep',
      dns: 'DNS Lookup',
      interfaces: 'Interfaces & ARP',
      pcap: 'Packet Capture',
      settings: 'Settings',
    };
    return titles[activeTab] || 'NetsCLI';
  };

  const showExport = output && Array.isArray(output.data) && output.data.length > 0;

  return (
    <div className={`container ${darkMode ? 'dark' : 'light'}`}>
      <TitleBar
        menus={[
          {
            label: 'File',
            items: [
              { label: 'Export Results...', action: () => { if (output) exportResults('json'); }, shortcut: 'Ctrl+E' },
              { label: 'separator', separator: true },
              { label: 'Exit', action: () => void closeAppWindow(), shortcut: 'Alt+F4' },
            ],
          },
          {
            label: 'Edit',
            items: [
              { label: 'Clear History', action: () => setScanHistory([]) },
              { label: 'separator', separator: true },
              { label: 'Preferences...', action: () => setActiveTab('settings'), shortcut: 'Ctrl+,' },
            ],
          },
          {
            label: 'View',
            items: [
              { label: darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode', action: () => setDarkMode(!darkMode), shortcut: 'Ctrl+D' },
              { label: 'separator', separator: true },
              { label: 'Dashboard', action: () => setActiveTab('dashboard'), shortcut: 'Ctrl+1' },
              { label: 'Discover', action: () => setActiveTab('discover'), shortcut: 'Ctrl+2' },
              { label: 'Port Scan', action: () => setActiveTab('scan'), shortcut: 'Ctrl+3' },
              { label: 'Inspect', action: () => setActiveTab('inspect'), shortcut: 'Ctrl+4' },
              { label: 'Sweep', action: () => setActiveTab('sweep'), shortcut: 'Ctrl+5' },
              { label: 'DNS', action: () => setActiveTab('dns'), shortcut: 'Ctrl+6' },
              { label: 'Interfaces', action: () => setActiveTab('interfaces'), shortcut: 'Ctrl+7' },
              { label: 'PCAP', action: () => setActiveTab('pcap'), shortcut: 'Ctrl+8' },
              { label: 'Settings', action: () => setActiveTab('settings'), shortcut: 'Ctrl+9' },
            ],
          },
          {
            label: 'Tools',
            items: [
              { label: 'Network Discovery', action: () => setActiveTab('discover') },
              { label: 'Port Scanner', action: () => setActiveTab('scan') },
              { label: 'Host Inspector', action: () => setActiveTab('inspect') },
              { label: 'Network Sweep', action: () => setActiveTab('sweep') },
              { label: 'DNS Lookup', action: () => setActiveTab('dns') },
            ],
          },
          {
            label: 'Help',
            items: [
              { label: 'Documentation', action: () => openHelpModal('docs') },
              { label: 'Keyboard Shortcuts', action: () => openHelpModal('shortcuts') },
              { label: 'separator', separator: true },
              { label: 'About NetsCLI', action: () => openHelpModal('about') },
            ],
          },
        ]}
      />
      <div className="app-header">
        <div className="app-header-left">
          <Banner />
        </div>
      </div>

      <div className="tool-selector" ref={toolSelectorRef}>
        <button
          className={`tool-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
          title="Dashboard"
        >
          <DashboardIcon size={16} />
          <span>Dashboard</span>
        </button>

        <button
          className={`tool-tab ${activeTab === 'discover' ? 'active' : ''}`}
          onClick={() => setActiveTab('discover')}
          title="Discover hosts on network"
        >
          <DiscoverIcon size={16} />
          {tabBusy['discover'] && <span className="tab-spinner"></span>}
          <span>Discover</span>
        </button>

        <button
          className={`tool-tab ${activeTab === 'scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('scan')}
          title="Scan ports on host"
        >
          <ScanIcon size={16} />
          {tabBusy['scan'] && <span className="tab-spinner"></span>}
          <span>Port Scan</span>
        </button>

        <button
          className={`tool-tab ${activeTab === 'inspect' ? 'active' : ''}`}
          onClick={() => setActiveTab('inspect')}
          title="Inspect host comprehensively"
        >
          <InspectIcon size={16} />
          {tabBusy['inspect'] && <span className="tab-spinner"></span>}
          <span>Inspect</span>
        </button>

        <button
          className={`tool-tab ${activeTab === 'sweep' ? 'active' : ''}`}
          onClick={() => setActiveTab('sweep')}
          title="Network sweep (discover + scan)"
        >
          <SweepIcon size={16} />
          {tabBusy['sweep'] && <span className="tab-spinner"></span>}
          <span>Sweep</span>
        </button>

        <button
          className={`tool-tab ${activeTab === 'dns' ? 'active' : ''}`}
          onClick={() => setActiveTab('dns')}
          title="DNS lookup"
        >
          <DnsIcon size={16} />
          {tabBusy['dns'] && <span className="tab-spinner"></span>}
          <span>DNS</span>
        </button>

        <button
          className={`tool-tab ${activeTab === 'interfaces' ? 'active' : ''}`}
          onClick={() => setActiveTab('interfaces')}
          title="Network interfaces and ARP table"
        >
          <InterfacesIcon size={16} />
          {tabBusy['interfaces'] && <span className="tab-spinner"></span>}
          <span>Interfaces</span>
        </button>

        <button
          className={`tool-tab ${activeTab === 'pcap' ? 'active' : ''}`}
          onClick={() => setActiveTab('pcap')}
          title="Packet capture"
        >
          <PcapIcon size={16} />
          {tabBusy['pcap'] && <span className="tab-spinner"></span>}
          <span>PCAP</span>
        </button>

        <div className="tool-selector-spacer"></div>

        <button
          className={`tool-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
          title="Settings"
        >
          <SettingsIcon size={16} />
          <span>Settings</span>
        </button>
      </div>

      <div className="workspace">
        {activeTab === 'dashboard' || activeTab === 'settings' ? (
          <div className="workspace-content-full">{renderContent()}</div>
        ) : (
          <div className="workspace-split">
            <div className="config-panel">
              <div className="config-panel-header">
                <h2 className="config-panel-title">{getPageTitle()}</h2>
              </div>
              <div className="config-panel-body">{renderToolbar()}</div>
            </div>

            <div className="results-panel">
              <div className="results-panel-header">
                <div className="results-header-left">
                  <div className="results-view-toggle">
                    <button
                      className={`results-view-btn ${viewMode === 'results' ? 'active' : ''}`}
                      onClick={() => setTabViewMode((prev) => ({ ...prev, [activeTab]: 'results' }))}
                    >
                      Results
                    </button>
                    <button
                      className={`results-view-btn ${viewMode === 'history' ? 'active' : ''}`}
                      onClick={() => setTabViewMode((prev) => ({ ...prev, [activeTab]: 'history' }))}
                    >
                      History{tabHistory.length > 0 ? ` (${tabHistory.length})` : ''}
                    </button>
                  </div>
                  {busy && (
                    <div className="scan-progress">
                      <div className="scan-progress-indicator"></div>
                      <span>Scanning...</span>
                    </div>
                  )}
                </div>

                {viewMode === 'results' && showExport && (
                  <div className="results-header-right">
                    <button
                      className="results-export-button"
                      onClick={() => exportResults('json')}
                      title="Export as JSON"
                    >
                      Export JSON
                    </button>
                    <button
                      className="results-export-button"
                      onClick={() => exportResults('csv')}
                      title="Export as CSV"
                    >
                      Export CSV
                    </button>
                  </div>
                )}
                {viewMode === 'history' && selectedHistoryIds.size > 0 && (
                  <div className="results-header-right">
                    <button
                      className="results-export-button"
                      onClick={exportSelectedHistory}
                      title="Export selected history entries as JSON"
                    >
                      Export Selected ({selectedHistoryIds.size})
                    </button>
                  </div>
                )}
              </div>

              <div className="results-panel-body">
                {viewMode === 'history' ? (
                  renderHistoryList()
                ) : (
                  <>
                    {error && <div className="error-banner">{error}</div>}
                    {activeTab === 'pcap' && error && (
                      <div className="info-banner">
                        <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                          How to enable PCAP
                        </div>
                        <ul>
                          {pcapGuidance(error).map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {renderContent()}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="status-bar">
        <div className="status-item">
          <div className={`status-indicator ${busy ? 'busy' : ''}`}></div>
          <span>{busy ? 'Scanning...' : 'Ready'}</span>
        </div>

        {defaultInterface && (
          <>
            <div className="status-item">
              <span className="status-label">{defaultInterface.name}</span>
              <span className="status-separator">-</span>
              <span className="status-value">{defaultInterface.ips[0] || 'N/A'}</span>
            </div>

            {networkStats && (
              <div className="status-item">
                <span className="status-label">down</span>
                <span className="status-value">{networkStats.download_mbps.toFixed(2)}</span>
                <span className="status-unit">Mbps</span>
                <span className="status-separator">-</span>
                <span className="status-label">up</span>
                <span className="status-value">{networkStats.upload_mbps.toFixed(2)}</span>
                <span className="status-unit">Mbps</span>
              </div>
            )}
          </>
        )}

        {output && Array.isArray(output.data) && (
          <div className="status-item">
            <span>
              {getResultCount()} result{getResultCount() !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div className="status-item" style={{ marginLeft: 'auto' }}>
          <span>{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
}

export default App;
