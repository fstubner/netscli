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
import { SettingsView } from './views/SettingsView';

const APP_VERSION = '0.1.0';

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

  const validateRequired = (field: string, value: string, label: string): boolean => {
    if (value.trim() === '') {
      setValidationErrors((prev) => ({ ...prev, [field]: `${label} is required` }));
      return false;
    }
    setValidationErrors((prev) => ({ ...prev, [field]: null }));
    return true;
  };

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

  const pcapGuidance = (err: string | null): string[] => {
    const tips: string[] = [
      'Pick an interface name from the Interfaces tab (e.g., eth0, wlan0, en0).',
      'PCAP capture often requires elevated privileges (root/admin) depending on OS and config.',
      'On Linux you may need libpcap installed and/or capabilities set for packet capture.',
      'On Windows, install Npcap (WinPcap-compatible mode) if capture is unavailable.',
    ];

    if (!err) return tips;

    const e = err.toLowerCase();
    if (e.includes('interface not found')) {
      tips.unshift('The selected interface was not found. Double-check the exact name.');
    }
    if (
      e.includes('permission') ||
      e.includes('operation not permitted') ||
      e.includes('access is denied')
    ) {
      tips.unshift(
        'This looks like a permissions issue. Try running as admin/root or granting capture capabilities.',
      );
    }
    if (e.includes('pcap unavailable') || e.includes('pcap support disabled')) {
      tips.unshift(
        'PCAP appears unavailable in this build/environment. Install libpcap/Npcap or use a build with PCAP enabled.',
      );
    }

    return tips;
  };

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

    switch (activeTab) {
      case 'discover':
        return (
          <div className="config-form">
            <div className="config-field">
              <label className="config-label">Subnet</label>
              <input
                className="config-input"
                value={subnet}
                onChange={(e) => setSubnet(e.target.value)}
                placeholder="192.168.1.0/24"
              />
            </div>
            <button
              className={`config-button ${busy ? 'cancel' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (busy) {
                  cancelOperation();
                } else {
                  void runOperation(
                    'discover',
                    { kind: 'discover', subnet: subnet || undefined },
                    async (op_id) => ({
                      kind: 'discover',
                      data: await netscli.discoverNetwork(subnet || undefined, op_id, true),
                    }),
                  );
                }
              }}
            >
              {busy ? 'Cancel Scan' : 'Start Scan'}
            </button>
          </div>
        );
      case 'scan':
        return (
          <div className="config-form">
            <div className="config-field">
              <label className="config-label">Host <span className="required">*</span></label>
              <input
                className={`config-input ${validationErrors.host ? 'input-error' : ''}`}
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setValidationErrors((prev) => ({ ...prev, host: null }));
                }}
                placeholder="192.168.1.1"
              />
              {validationErrors.host && (
                <span className="validation-error">{validationErrors.host}</span>
              )}
            </div>
            <div className="config-field">
              <label className="config-label">Ports</label>
              <input
                className="config-input"
                value={ports}
                onChange={(e) => setPorts(e.target.value)}
                placeholder="22,80,443"
              />
            </div>
            <button
              className={`config-button ${busy ? 'cancel' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (busy) {
                  cancelOperation();
                } else {
                  if (!validateRequired('host', host, 'Host')) return;
                  void runOperation(
                    'scan',
                    { kind: 'scan', host, ports: ports || undefined },
                    async (op_id) => ({
                      kind: 'scan',
                      data: await netscli.scanPorts(host, ports || undefined, op_id),
                    }),
                  );
                }
              }}
            >
              {busy ? 'Cancel Scan' : 'Start Scan'}
            </button>
          </div>
        );
      case 'inspect':
        return (
          <div className="config-form">
            <div className="config-field">
              <label className="config-label">Host <span className="required">*</span></label>
              <input
                className={`config-input ${validationErrors.host ? 'input-error' : ''}`}
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setValidationErrors((prev) => ({ ...prev, host: null }));
                }}
                placeholder="192.168.1.1"
              />
              {validationErrors.host && (
                <span className="validation-error">{validationErrors.host}</span>
              )}
            </div>
            <div className="config-field">
              <label className="config-label">Ports</label>
              <input
                className="config-input"
                value={ports}
                onChange={(e) => setPorts(e.target.value)}
                placeholder="22,80,443"
              />
            </div>
            <button
              className={`config-button ${busy ? 'cancel' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (busy) {
                  cancelOperation();
                } else {
                  if (!validateRequired('host', host, 'Host')) return;
                  void runOperation(
                    'inspect',
                    { kind: 'inspect', host, ports: ports || undefined },
                    async (op_id) => ({
                      kind: 'inspect',
                      data: await netscli.inspectHost(host, ports || undefined, op_id),
                    }),
                  );
                }
              }}
            >
              {busy ? 'Cancel Scan' : 'Inspect Host'}
            </button>
          </div>
        );
      case 'sweep':
        return (
          <div className="config-form">
            <div className="config-field">
              <label className="config-label">Subnet</label>
              <input
                className="config-input"
                value={subnet}
                onChange={(e) => setSubnet(e.target.value)}
                placeholder="192.168.1.0/24"
              />
            </div>
            <div className="config-field">
              <label className="config-label">Ports</label>
              <input
                className="config-input"
                value={ports}
                onChange={(e) => setPorts(e.target.value)}
                placeholder="80,443"
              />
            </div>
            <button
              className={`config-button ${busy ? 'cancel' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (busy) {
                  cancelOperation();
                } else {
                  void runOperation(
                    'sweep',
                    { kind: 'sweep', subnet: subnet || undefined, ports: ports || undefined },
                    async (op_id) => ({
                      kind: 'sweep',
                      data: await netscli.sweepNetwork(
                        subnet || undefined,
                        ports || undefined,
                        op_id,
                        true,
                      ),
                    }),
                  );
                }
              }}
            >
              {busy ? 'Cancel Scan' : 'Start Sweep'}
            </button>
          </div>
        );
      case 'dns':
        return (
          <div className="config-form">
            <div className="config-field">
              <label className="config-label">Hostname <span className="required">*</span></label>
              <input
                className={`config-input ${validationErrors.host ? 'input-error' : ''}`}
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setValidationErrors((prev) => ({ ...prev, host: null }));
                }}
                placeholder="google.com"
              />
              {validationErrors.host && (
                <span className="validation-error">{validationErrors.host}</span>
              )}
            </div>
            <div className="config-field">
              <label className="config-label">Type</label>
              <select
                className="config-input"
                value={dnsType}
                onChange={(e) => setDnsType(e.target.value as DnsRecordType)}
              >
                <option value="A">A (IPv4)</option>
                <option value="AAAA">AAAA (IPv6)</option>
              </select>
            </div>
            <button
              className={`config-button ${busy ? 'cancel' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (busy) {
                  cancelOperation();
                } else {
                  if (!validateRequired('host', host, 'Hostname')) return;
                  void runOperation(
                    'dns',
                    { kind: 'dns', host, record: dnsType },
                    async (op_id) => ({
                      kind: 'dns',
                      data: await netscli.dnsLookup(host, dnsType, op_id),
                    }),
                  );
                }
              }}
            >
              {busy ? 'Cancel' : 'Resolve'}
            </button>
          </div>
        );
      case 'interfaces':
        return (
          <div className="config-form">
            <button
              className={`config-button ${busy ? 'cancel' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (busy) {
                  cancelOperation();
                } else {
                  void runOperation(
                    'interfaces',
                    { kind: 'interfaces' },
                    async (op_id) => ({
                      kind: 'interfaces',
                      data: await netscli.listInterfaces(op_id),
                    }),
                  );
                }
              }}
            >
              {busy ? 'Cancel' : 'Refresh Interfaces'}
            </button>
            <button
              className={`config-button ${busy ? 'cancel' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (busy) {
                  cancelOperation();
                } else {
                  void runOperation(
                    'interfaces',
                    { kind: 'arp' },
                    async (op_id) => ({ kind: 'arp', data: await netscli.getArpTable(op_id) }),
                  );
                }
              }}
            >
              {busy ? 'Cancel' : 'Show ARP Table'}
            </button>
          </div>
        );
      case 'pcap':
        return (
          <div className="config-form">
            <div className="info-banner" style={{ margin: '0 0 1rem 0' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>PCAP tips</div>
              <ul>
                {pcapGuidance(error)
                  .slice(0, 4)
                  .map((t) => (
                    <li key={t}>{t}</li>
                  ))}
              </ul>
            </div>
            <div className="config-field">
              <label className="config-label">
                Interface <span className="required">*</span>
              </label>
              <input
                className={`config-input ${validationErrors.pcapInterface ? 'input-error' : ''}`}
                value={pcapInterface}
                onChange={(e) => {
                  setPcapInterface(e.target.value);
                  setValidationErrors((prev) => ({ ...prev, pcapInterface: null }));
                }}
                placeholder="eth0"
              />
              {validationErrors.pcapInterface && (
                <span className="validation-error">{validationErrors.pcapInterface}</span>
              )}
            </div>
            <div className="config-field">
              <label className="config-label">Duration (seconds, 1–3600)</label>
              <input
                className={`config-input ${validationErrors.pcapDuration ? 'input-error' : ''}`}
                type="number"
                min={1}
                max={3600}
                value={pcapDuration}
                onChange={(e) => {
                  setPcapDuration(e.target.value);
                  setValidationErrors((prev) => ({ ...prev, pcapDuration: null }));
                }}
                placeholder="5"
              />
              {validationErrors.pcapDuration && (
                <span className="validation-error">{validationErrors.pcapDuration}</span>
              )}
            </div>
            <button
              className={`config-button ${busy ? 'cancel' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (busy) {
                  cancelOperation();
                  return;
                }
                // Validate before firing: the backend clamps duration to
                // (1, 3600] but the user deserves an inline error instead
                // of a round-trip for an obviously bad input.
                if (!validateRequired('pcapInterface', pcapInterface, 'Interface')) return;
                const duration = Number.parseInt(pcapDuration, 10);
                if (!Number.isFinite(duration) || duration <= 0) {
                  setValidationErrors((prev) => ({
                    ...prev,
                    pcapDuration: 'Duration must be a positive number of seconds',
                  }));
                  return;
                }
                if (duration > 3600) {
                  setValidationErrors((prev) => ({
                    ...prev,
                    pcapDuration: 'Duration capped at 3600 seconds (1 hour)',
                  }));
                  return;
                }
                setValidationErrors((prev) => ({
                  ...prev,
                  pcapInterface: null,
                  pcapDuration: null,
                }));
                void runOperation(
                  'pcap',
                  { kind: 'pcap', interface: pcapInterface, duration },
                  async (op_id) => ({
                    kind: 'pcap',
                    data: await netscli.capturePcap(
                      { interface: pcapInterface, duration },
                      op_id,
                    ),
                  }),
                );
              }}
            >
              {busy ? 'Cancel' : 'Start Capture'}
            </button>
          </div>
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

    switch (output.kind) {
      case 'discover': {
        const hosts = output.data;
        if (hosts.length > 0) {
          return (
            <table className="results-table">
              <thead>
                <tr>
                  <th>IP Address</th>
                  <th>MAC Address</th>
                  <th>Vendor</th>
                  <th>Hostname</th>
                </tr>
              </thead>
              <tbody>
                {hosts.map((h) => (
                  <tr key={h.ip}>
                    <td>{h.ip}</td>
                    <td>{h.mac || '-'}</td>
                    <td>{h.vendor || '-'}</td>
                    <td>{h.hostname || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return (
          <div className="empty-state">
            <div className="empty-state-text">No hosts discovered</div>
          </div>
        );
      }

      case 'scan': {
        const results = output.data;
        const openPorts = results.filter((p) => p.open);
        if (openPorts.length === 0) {
          return (
            <div className="empty-state">
              <div className="empty-state-text">No open ports found</div>
            </div>
          );
        }
        return (
          <table className="results-table">
            <thead>
              <tr>
                <th>Port</th>
                <th>Service</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {openPorts.map((p) => (
                <tr key={p.port}>
                  <td>{p.port}</td>
                  <td>{p.service || 'unknown'}</td>
                  <td>
                    <span style={{ color: '#00a86b', fontWeight: 500 }}>OPEN</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }

      case 'inspect':
        return (
          <div className="json-view">
            <pre>{JSON.stringify(output.data, null, 2)}</pre>
          </div>
        );

      case 'sweep': {
        const entries = output.data;
        if (entries.length === 0) {
          return (
            <div className="empty-state">
              <div className="empty-state-text">No results</div>
            </div>
          );
        }
        return (
          <div>
            {entries.map((s) => (
              <div key={s.host.ip} className="host-card">
                <h4>
                  {s.host.ip} {s.host.hostname && `(${s.host.hostname})`}
                </h4>
                {s.open_ports.length > 0 ? (
                  <table className="results-table" style={{ marginTop: '0.5rem' }}>
                    <thead>
                      <tr>
                        <th>Port</th>
                        <th>Service</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.open_ports.map((p) => (
                        <tr key={p.port}>
                          <td>{p.port}</td>
                          <td>{p.service || 'unknown'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ color: '#999', fontSize: '0.875rem' }}>No open ports</div>
                )}
              </div>
            ))}
          </div>
        );
      }

      case 'dns': {
        // Backend returns DnsRecord[] — one row per answer, with the type
        // and its normalized value. Render as a two-column table so users
        // can tell an A from an MX from a TXT at a glance.
        const records = output.data;
        if (records.length === 0) {
          return (
            <div className="empty-state">
              <div className="empty-state-text">No results</div>
            </div>
          );
        }
        return (
          <table className="results-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, idx) => (
                <tr key={`${r.record_type}-${r.value}-${idx}`}>
                  <td>{r.record_type}</td>
                  <td>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }

      case 'interfaces': {
        const interfaces = output.data;
        if (interfaces.length === 0) {
          return (
            <div className="empty-state">
              <div className="empty-state-text">No interfaces found</div>
            </div>
          );
        }
        return (
          <table className="results-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th>MAC Address</th>
                <th>Addresses</th>
              </tr>
            </thead>
            <tbody>
              {interfaces.map((iface) => (
                <tr key={iface.name}>
                  <td>
                    {iface.name}
                    {iface.is_loopback && (
                      <span className="row-badge row-badge-muted" title="Loopback interface">
                        loopback
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`row-badge ${iface.is_up ? 'row-badge-up' : 'row-badge-down'}`}
                    >
                      {iface.is_up ? 'UP' : 'DOWN'}
                    </span>
                  </td>
                  <td className="mono-cell">{iface.mac || '-'}</td>
                  <td className="mono-cell">
                    {iface.ips.length === 0 ? (
                      <span className="dim">-</span>
                    ) : (
                      iface.ips.map((ip) => (
                        <div key={ip} className="ip-line">
                          {ip}
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }

      case 'arp': {
        const entries = output.data;
        if (entries.length === 0) {
          return (
            <div className="empty-state">
              <div className="empty-state-text">No data</div>
            </div>
          );
        }
        return (
          <table className="results-table">
            <thead>
              <tr>
                <th>IP Address</th>
                <th>MAC Address</th>
                <th>Interface</th>
                <th>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`${e.ip}-${e.mac}-${e.interface}`}>
                  <td>{e.ip}</td>
                  <td>{e.mac}</td>
                  <td>{e.interface}</td>
                  <td>{e.vendor || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }

      case 'pcap': {
        const r = output.data;
        // Duration comes across as { secs, nanos }; flatten to a human-readable
        // seconds value with one decimal.
        const durSecs = r.duration.secs + r.duration.nanos / 1e9;
        return (
          <div className="pcap-summary">
            <div className="pcap-stat">
              <div className="pcap-stat-label">Packets captured</div>
              <div className="pcap-stat-value">{r.packets_captured.toLocaleString()}</div>
            </div>
            <div className="pcap-stat">
              <div className="pcap-stat-label">Duration</div>
              <div className="pcap-stat-value">{durSecs.toFixed(2)} s</div>
            </div>
            <div className="pcap-stat pcap-stat-path">
              <div className="pcap-stat-label">Output file</div>
              <div className="pcap-stat-value mono-cell" title={r.file_path}>
                {r.file_path}
              </div>
            </div>
          </div>
        );
      }

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
