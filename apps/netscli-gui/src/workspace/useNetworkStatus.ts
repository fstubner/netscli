import { useEffect, useMemo, useRef, useState } from 'react';

import { isTauri } from '../services/env';
import * as netscli from '../services/netscli';
import type { DefaultInterfaceInfo, InterfaceInfo, NetworkStats } from '../types/netscli';
import type { WorkspaceToast } from './types';

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
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [defaultInterface, setDefaultInterface] = useState<DefaultInterfaceInfo | null>(null);
  const [trafficInterfaceName, setTrafficInterfaceNameState] = useState<string | null>(
    initialTrafficInterfaceName,
  );
  const [interfaces, setInterfaces] = useState<InterfaceInfo[]>([]);
  const initializedTrafficInterface = useRef(false);

  const trafficInterface = useMemo(() => {
    const iface = interfaces.find((item) => item.name === trafficInterfaceName);
    if (iface) return toStatusInterface(iface);
    if (!trafficInterfaceName) return defaultInterface;
    return null;
  }, [defaultInterface, interfaces, trafficInterfaceName]);

  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;

    const loadInterfaceInfo = async () => {
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
    const id = window.setInterval(loadInterfaceInfo, 10000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!isTauri() || !trafficInterfaceName) return;
    let stopped = false;

    const loadNetworkStats = async () => {
      const stats = await netscli.getNetworkStats(trafficInterfaceName).catch(() => null);
      if (!stopped && stats) setNetworkStats(stats);
    };

    void loadNetworkStats();
    const id = window.setInterval(loadNetworkStats, 250);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [trafficInterfaceName]);

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
    if (!next) return;
    window.localStorage.setItem('netscli-traffic-interface', next);
    setTrafficInterfaceNameState(next);
    showToast({ message: `Monitoring ${next}`, kind: 'interaction' });
  }

  return {
    defaultInterface,
    interfaces,
    networkStats,
    setTrafficInterfaceName,
    trafficInterface,
    trafficInterfaceName,
  };
}

