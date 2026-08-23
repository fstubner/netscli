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

/**
 * Read a persisted number, distinguishing "never set" from a stored value.
 *
 * `Number(null)` is `0`, and `Number.isFinite(0)` is `true`, so the obvious
 * spelling treats a missing key as a stored zero and the default branch never
 * runs. That gave a fresh install 1 concurrent probe instead of 256 -- every
 * scan, discover and sweep serialised -- and traffic precision 0 instead of
 * 2. Both read as deliberate settings, which is why neither was noticed.
 */
function storedNumber(key: string): number | null {
  const raw = window.localStorage.getItem(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Undo the values the zero-default bug wrote, once.
 *
 * Fixing `storedNumber` only helps an install that never ran the broken
 * build. Everyone else already has the bad value persisted -- the hook
 * writes every preference back on mount, so the very first launch saved
 * `1` probes and `0` precision as though they had been chosen. Reading
 * them correctly now just reads a wrong number correctly, and the install
 * stays serialised forever.
 *
 * Only concurrency is repaired. 1 probe is never a sensible choice -- it
 * serialises every scan, discover and sweep -- so a stored 1 at this moment
 * is the bug's fingerprint rather than a preference. Traffic precision is
 * deliberately left alone: 0 decimals is a reasonable thing to want, the
 * cost of being wrong is cosmetic, and overriding a real choice to fix a
 * rounding display is the worse trade. Anyone bitten by that half can change
 * it in Settings.
 *
 * The marker makes this run exactly once, so a genuine later choice of 1 is
 * never second-guessed.
 */
function repairZeroDefaults(): void {
  const REPAIRED = 'netscli-prefs-repaired-zero-defaults';
  if (window.localStorage.getItem(REPAIRED) === 'done') return;

  // Repair first, mark second. Marking first burns the one chance this gets:
  // if anything writes the bad value back before the work happens -- another
  // instance of the app sharing the profile, a crash between the two lines --
  // the marker says "handled" forever and the install stays serialised with
  // no way back. Observed exactly that: a profile went 1 -> 256 -> 1 with the
  // marker set, and nothing could recover it.
  if (window.localStorage.getItem('netscli-max-concurrent-probes') === '1') {
    window.localStorage.setItem('netscli-max-concurrent-probes', '256');
  }
  window.localStorage.setItem(REPAIRED, 'done');
}

function initialTrafficPrecision(): TrafficPrecision {
  if (typeof window === 'undefined') return 2;
  const value = storedNumber('netscli-traffic-precision');
  return value === 0 || value === 1 || value === 2 ? value : 2;
}

function initialAddressPreference(): AddressPreference {
  if (typeof window === 'undefined') return 'ipv4';
  const value = window.localStorage.getItem('netscli-address-preference');
  return value === 'ipv6' ? 'ipv6' : 'ipv4';
}

function initialMaxConcurrentProbes(): MaxConcurrentProbes {
  if (typeof window === 'undefined') return 256;
  repairZeroDefaults();
  const value = storedNumber('netscli-max-concurrent-probes');
  return value === null ? 256 : clampMaxConcurrentProbes(value);
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
