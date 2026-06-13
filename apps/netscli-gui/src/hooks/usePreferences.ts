import { useEffect, useState } from 'react';

export type TrafficDisplayUnit = 'Gbps' | 'Mbps' | 'Kbps';
export type TrafficPrecision = 0 | 1 | 2;

function initialDarkMode(): boolean {
  if (typeof window === 'undefined') return true;
  const themeParam = new URLSearchParams(window.location.search).get('theme');
  if (themeParam === 'light') return false;
  if (themeParam === 'dark') return true;
  return window.localStorage.getItem('netscli-theme') !== 'light';
}

function initialTrafficIndicators(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('netscli-traffic-indicators') !== 'off';
}

function initialTrafficDisplayUnit(): TrafficDisplayUnit {
  if (typeof window === 'undefined') return 'Mbps';
  const value = window.localStorage.getItem('netscli-traffic-display-unit');
  return value === 'Gbps' || value === 'Mbps' || value === 'Kbps' ? value : 'Mbps';
}

function initialTrafficPrecision(): TrafficPrecision {
  if (typeof window === 'undefined') return 2;
  const value = Number(window.localStorage.getItem('netscli-traffic-precision'));
  return value === 0 || value === 1 || value === 2 ? value : 2;
}

function initialCommandBarVisible(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('netscli-command-bar') !== 'off';
}

function initialInteractionToasts(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('netscli-interaction-toasts') !== 'off';
}

function initialOperationToasts(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('netscli-operation-toasts') !== 'off';
}

function initialReleaseNotifications(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('netscli-release-notifications') !== 'off';
}

function initialPersistentHistory(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('netscli-persistent-history') !== 'off';
}

export function usePreferences() {
  const [darkMode, setDarkMode] = useState(initialDarkMode);
  const [trafficIndicators, setTrafficIndicators] = useState(initialTrafficIndicators);
  const [trafficDisplayUnit, setTrafficDisplayUnit] = useState<TrafficDisplayUnit>(initialTrafficDisplayUnit);
  const [trafficPrecision, setTrafficPrecision] = useState<TrafficPrecision>(initialTrafficPrecision);
  const [commandBarVisible, setCommandBarVisible] = useState(initialCommandBarVisible);
  const [interactionToasts, setInteractionToasts] = useState(initialInteractionToasts);
  const [operationToasts, setOperationToasts] = useState(initialOperationToasts);
  const [releaseNotifications, setReleaseNotifications] = useState(initialReleaseNotifications);
  const [persistentHistory, setPersistentHistory] = useState(initialPersistentHistory);

  useEffect(() => {
    window.localStorage.setItem('netscli-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    window.localStorage.setItem('netscli-traffic-indicators', trafficIndicators ? 'on' : 'off');
  }, [trafficIndicators]);

  useEffect(() => {
    window.localStorage.setItem('netscli-traffic-display-unit', trafficDisplayUnit);
  }, [trafficDisplayUnit]);

  useEffect(() => {
    window.localStorage.setItem('netscli-traffic-precision', String(trafficPrecision));
  }, [trafficPrecision]);

  useEffect(() => {
    window.localStorage.setItem('netscli-command-bar', commandBarVisible ? 'on' : 'off');
  }, [commandBarVisible]);

  useEffect(() => {
    window.localStorage.setItem('netscli-interaction-toasts', interactionToasts ? 'on' : 'off');
  }, [interactionToasts]);

  useEffect(() => {
    window.localStorage.setItem('netscli-operation-toasts', operationToasts ? 'on' : 'off');
  }, [operationToasts]);

  useEffect(() => {
    window.localStorage.setItem('netscli-release-notifications', releaseNotifications ? 'on' : 'off');
  }, [releaseNotifications]);

  useEffect(() => {
    window.localStorage.setItem('netscli-persistent-history', persistentHistory ? 'on' : 'off');
  }, [persistentHistory]);

  return {
    commandBarVisible,
    darkMode,
    interactionToasts,
    operationToasts,
    persistentHistory,
    releaseNotifications,
    setCommandBarVisible,
    setDarkMode,
    setInteractionToasts,
    setOperationToasts,
    setPersistentHistory,
    setReleaseNotifications,
    setTrafficDisplayUnit,
    setTrafficIndicators,
    setTrafficPrecision,
    trafficDisplayUnit,
    trafficIndicators,
    trafficPrecision,
  };
}
