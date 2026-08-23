import { useEffect, useState } from 'react';

export type TrafficDisplayUnit = 'Gbps' | 'Mbps' | 'Kbps';
export type TrafficPrecision = 0 | 1 | 2;
export type AddressPreference = 'ipv4' | 'ipv6';
export type MaxConcurrentProbes = number;

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

function initialAddressPreference(): AddressPreference {
  if (typeof window === 'undefined') return 'ipv4';
  const value = window.localStorage.getItem('netscli-address-preference');
  return value === 'ipv6' ? 'ipv6' : 'ipv4';
}

function initialMaxConcurrentProbes(): MaxConcurrentProbes {
  if (typeof window === 'undefined') return 256;
  const value = Number(window.localStorage.getItem('netscli-max-concurrent-probes'));
  return Number.isFinite(value) ? clampMaxConcurrentProbes(value) : 256;
}

export function clampMaxConcurrentProbes(value: number): MaxConcurrentProbes {
  return Math.min(1024, Math.max(1, Math.round(value)));
}

function initialCommandBarVisible(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('netscli-command-bar') !== 'off';
}

// Toasts are opt-in. They were opt-out, which meant a new user met the app
// through a stream of notifications about things they had just done
// themselves and could already see on screen. Both toggles remain in
// Settings for anyone who wants the running commentary.
//
// Errors are not covered by these: a failure still surfaces, because the
// alternative is a table that stays empty with no reason given.
function initialInteractionToasts(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('netscli-interaction-toasts') === 'on';
}

function initialOperationToasts(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('netscli-operation-toasts') === 'on';
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
  const [addressPreference, setAddressPreference] = useState<AddressPreference>(initialAddressPreference);
  const [maxConcurrentProbes, setMaxConcurrentProbes] =
    useState<MaxConcurrentProbes>(initialMaxConcurrentProbes);
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
    window.localStorage.setItem('netscli-address-preference', addressPreference);
  }, [addressPreference]);

  useEffect(() => {
    window.localStorage.setItem('netscli-max-concurrent-probes', String(maxConcurrentProbes));
  }, [maxConcurrentProbes]);

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
    addressPreference,
    darkMode,
    interactionToasts,
    maxConcurrentProbes,
    operationToasts,
    persistentHistory,
    releaseNotifications,
    setCommandBarVisible,
    setAddressPreference,
    setDarkMode,
    setInteractionToasts,
    setMaxConcurrentProbes,
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
