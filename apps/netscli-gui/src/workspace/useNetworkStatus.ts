import { useEffect, useMemo, useRef, useState } from 'react';

import { isTauri } from '../services/env';
import * as netscli from '../services/netscli';
import type { DefaultInterfaceInfo, InterfaceInfo, NetworkStats } from '../types/netscli';
import type { WorkspaceToast } from './types';
import {
  DEMO_DEFAULT_INTERFACE,
  DEMO_INTERFACE,
  DEMO_NETWORK_STATS,
  isDemoScreenshotMode,
} from './demoMode';

const INTERFACE_REFRESH_INTERVAL_MS = 30000;
// Three misses is 90 seconds of no interface data -- long enough that a slow
// first poll or a single transient failure stays silent, short enough that a
// user staring at "Detecting..." gets told why.
const INTERFACE_FAILURES_BEFORE_WARNING = 3;
const NETWORK_STATS_INTERVAL_MS = 3000;

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function initialTrafficInterfaceName(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('netscli-traffic-interface') || null;
}

function toStatusInterface(iface: InterfaceInfo): DefaultInterfaceInfo {
  return {
    name: iface.name,
    ips: iface.ips,
    is_up: iface.is_up,
  };
}

/**
 * Choose the interface whose throughput to display.
 *
 * Preferring a monitorable name is the whole point. Traffic counters come
 * from a different enumeration than the interface list, and tunnel and VPN
 * adapters routinely appear in the list without appearing in the counters --
 * on one machine, seven of twelve interfaces had no counterpart, including
 * the Tailscale adapter that was up and was what the old order selected
 * first. The result was a status bar that silently showed no throughput at
 * all, permanently.
 *
 * The previous order is kept as the fallback rather than replaced: if
 * nothing is monitorable, showing the platform's default interface and an
 * honest "no traffic data" beats showing nothing at all.
 */
export function pickTrafficInterface(
  iface: DefaultInterfaceInfo | null,
  allInterfaces: InterfaceInfo[],
  monitorable: string[],
): string | null {
  const canMonitor = (name: string | undefined | null): name is string =>
    Boolean(name) && monitorable.includes(name as string);

  const usable = allInterfaces.filter((item) => item.is_up && !item.is_loopback);
  return (
    // The platform default, but only if its throughput can actually be read.
    (canMonitor(iface?.name) ? iface?.name : undefined) ??
    usable.find((item) => canMonitor(item.name))?.name ??
    allInterfaces.find((item) => canMonitor(item.name))?.name ??
    // Nothing monitorable: fall back to what this always did.
    iface?.name ??
    usable[0]?.name ??
    allInterfaces[0]?.name ??
    null
  );
}

export function useNetworkStatus(showToast: (toast: Omit<WorkspaceToast, 'id'>) => void) {
  const demoScreenshotMode = isDemoScreenshotMode();
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(
    demoScreenshotMode ? DEMO_NETWORK_STATS : null,
  );
  const [defaultInterface, setDefaultInterface] = useState<DefaultInterfaceInfo | null>(
    demoScreenshotMode ? DEMO_DEFAULT_INTERFACE : null,
  );
  const [trafficInterfaceName, setTrafficInterfaceNameState] = useState<string | null>(
    () => (demoScreenshotMode ? DEMO_INTERFACE.name : initialTrafficInterfaceName()),
  );
  const [interfaces, setInterfaces] = useState<InterfaceInfo[]>(() =>
    demoScreenshotMode ? [DEMO_INTERFACE] : [],
  );
  const initializedTrafficInterface = useRef(false);
  const trafficInterfaceNameRef = useRef(trafficInterfaceName);
  const interfaceFailures = useRef(0);

  useEffect(() => {
    trafficInterfaceNameRef.current = trafficInterfaceName;
  }, [trafficInterfaceName]);

  const trafficInterface = useMemo(() => {
    const iface = interfaces.find((item) => item.name === trafficInterfaceName);
    if (iface) return toStatusInterface(iface);
    return null;
  }, [interfaces, trafficInterfaceName]);

  const statusInterfaceInfo = useMemo((): DefaultInterfaceInfo | null => {
    if (trafficInterfaceName) {
      const found = interfaces.find((item) => item.name === trafficInterfaceName);
      if (found) return toStatusInterface(found);
      return { name: trafficInterfaceName, ips: [], is_up: false };
    }
    return defaultInterface;
  }, [defaultInterface, interfaces, trafficInterfaceName]);

  useEffect(() => {
    if (demoScreenshotMode) return;
    setNetworkStats(null);
  }, [demoScreenshotMode, trafficInterfaceName]);

  useEffect(() => {
    if (demoScreenshotMode || interfaces.length === 0 || !trafficInterfaceName) return;
    if (interfaces.some((item) => item.name === trafficInterfaceName)) return;

    const fallback =
      defaultInterface?.name ??
      interfaces.find((item) => item.is_up && !item.is_loopback)?.name ??
      interfaces[0]?.name ??
      null;
    if (!fallback || fallback === trafficInterfaceName) return;

    window.localStorage.setItem('netscli-traffic-interface', fallback);
    setTrafficInterfaceNameState(fallback);
    setNetworkStats(null);
  }, [defaultInterface, demoScreenshotMode, interfaces, trafficInterfaceName]);

  useEffect(() => {
    if (demoScreenshotMode || !isTauri()) return;
    let stopped = false;

    const loadInterfaceInfo = async () => {
      if (!isDocumentVisible()) return;
      try {
        const [iface, allInterfaces, monitorable] = await Promise.all([
          netscli.getDefaultInterface().catch(() => null),
          netscli.listInterfaces().catch(() => null),
          // Failure here is not fatal: an empty list simply means selection
          // falls back to the order it always used.
          netscli.listMonitorableInterfaces().catch(() => []),
        ]);
        if (stopped) return;
        if (iface) setDefaultInterface(iface);
        if (allInterfaces) {
          setInterfaces(allInterfaces);
          initializeTrafficInterface(iface, allInterfaces, monitorable ?? []);
        }

        // Every failure here used to be swallowed on a 30s timer, so a
        // backend that had stopped answering showed a permanent
        // "Detecting..." and an empty interface list in the capture form,
        // with nothing to distinguish that from a slow first poll.
        if (iface || allInterfaces) {
          interfaceFailures.current = 0;
        } else {
          reportInterfaceFailure();
        }
      } catch {
        if (!stopped) reportInterfaceFailure();
      }
    };

    // Announce once, on the way past the threshold, and stay quiet until a
    // poll succeeds again. A toast every 30 seconds would be its own defect.
    const reportInterfaceFailure = () => {
      interfaceFailures.current += 1;
      if (interfaceFailures.current !== INTERFACE_FAILURES_BEFORE_WARNING) return;
      showToast({
        kind: 'interaction',
        message: 'Network interfaces are not responding. Interface-dependent tools may be unavailable.',
      });
    };

    void loadInterfaceInfo();
    const id = window.setInterval(loadInterfaceInfo, INTERFACE_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (isDocumentVisible()) void loadInterfaceInfo();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(id);
    };
    // `showToast` is rebuilt every render, so depending on it would tear down
    // and restart the 30s poll continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoScreenshotMode]);

  useEffect(() => {
    if (demoScreenshotMode || !isTauri() || !trafficInterfaceName) return;
    let stopped = false;

    const loadNetworkStats = async () => {
      if (!isDocumentVisible()) return;
      const stats = await netscli.getNetworkStats(trafficInterfaceName).catch(() => null);
      if (stopped) return;
      if (stats) {
        setNetworkStats((current) => (sameNetworkStats(current, stats) ? current : stats));
      } else {
        setNetworkStats(null);
      }
    };

    void loadNetworkStats();
    const id = window.setInterval(loadNetworkStats, NETWORK_STATS_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (isDocumentVisible()) void loadNetworkStats();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(id);
    };
  }, [demoScreenshotMode, trafficInterfaceName]);

  function initializeTrafficInterface(
    iface: DefaultInterfaceInfo | null,
    allInterfaces: InterfaceInfo[],
    monitorable: string[],
  ) {
    if (initializedTrafficInterface.current) return;
    const saved = initialTrafficInterfaceName();
    const savedExists = saved && allInterfaces.some((item) => item.name === saved);
    const next = savedExists ? saved : pickTrafficInterface(iface, allInterfaces, monitorable);
    if (next) {
      setTrafficInterfaceNameState(next);
      window.localStorage.setItem('netscli-traffic-interface', next);
    }
    initializedTrafficInterface.current = true;
  }

  function setTrafficInterfaceName(name: string) {
    const next = name.trim();
    if (!next || next === trafficInterfaceNameRef.current) return;
    window.localStorage.setItem('netscli-traffic-interface', next);
    setTrafficInterfaceNameState(next);
    showToast({ message: `Monitoring ${next}`, kind: 'interaction' });
  }

  return {
    defaultInterface,
    interfaces,
    networkStats,
    setTrafficInterfaceName,
    statusInterfaceInfo,
    trafficInterface,
    trafficInterfaceName,
  };
}

function sameNetworkStats(current: NetworkStats | null, next: NetworkStats): boolean {
  return Boolean(
    current &&
      current.upload_mbps === next.upload_mbps &&
      current.download_mbps === next.download_mbps &&
      current.upload_active === next.upload_active &&
      current.download_active === next.download_active &&
      current.available === next.available,
  );
}
