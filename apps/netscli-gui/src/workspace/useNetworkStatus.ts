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
        const [iface, allInterfaces] = await Promise.all([
          netscli.getDefaultInterface().catch(() => null),
          netscli.listInterfaces().catch(() => null),
        ]);
        if (stopped) return;
        if (iface) setDefaultInterface(iface);
        if (allInterfaces) {
          setInterfaces(allInterfaces);
          initializeTrafficInterface(iface, allInterfaces);
        }
      } catch {
        return;
      }
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

  function initializeTrafficInterface(iface: DefaultInterfaceInfo | null, allInterfaces: InterfaceInfo[]) {
    if (initializedTrafficInterface.current) return;
    const saved = initialTrafficInterfaceName();
    const savedExists = saved && allInterfaces.some((item) => item.name === saved);
    const fallback =
      iface?.name ??
      allInterfaces.find((item) => item.is_up && !item.is_loopback)?.name ??
      allInterfaces[0]?.name ??
      null;
    const next = savedExists ? saved : fallback;
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
