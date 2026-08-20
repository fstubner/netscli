import { describe, expect, it } from 'vitest';

import { pickTrafficInterface } from './useNetworkStatus';
import type { DefaultInterfaceInfo, InterfaceInfo } from '../types/netscli';

/**
 * The status bar showed no throughput at all, permanently, on any machine
 * whose default interface was a tunnel or VPN adapter.
 *
 * Traffic counters come from a different enumeration than the interface
 * list, and the two disagree. Measured on one Windows machine: twelve
 * interfaces listed, five with counters, and seven -- including the
 * Tailscale adapter that was up and was chosen first -- present in the list
 * and absent from the counters. Selecting one of those left the traffic
 * display empty with nothing to explain it.
 *
 * The fixture below is that machine.
 */
const iface = (name: string, is_up = true, is_loopback = false): InterfaceInfo =>
  ({ name, ips: [], is_up, is_loopback }) as unknown as InterfaceInfo;

const LISTED: InterfaceInfo[] = [
  iface('Eth 1G', false),
  iface('Tailscale'),
  iface('Eth 2.5G'),
  iface('WiFi', false),
  iface('VMware Network Adapter VMnet1'),
  iface('Loopback Pseudo-Interface 1', true, true),
];

// What `sysinfo` reports counters for: no Tailscale, no WiFi, no loopback.
const MONITORABLE = ['Eth 2.5G', 'VMware Network Adapter VMnet1'];

const asDefault = (name: string): DefaultInterfaceInfo =>
  ({ name, ips: [], is_up: true }) as unknown as DefaultInterfaceInfo;

describe('pickTrafficInterface', () => {
  it('does not pick the platform default when its throughput cannot be read', () => {
    // The regression. The platform default here is Tailscale, which has no
    // counters; the old order took it unconditionally and the traffic
    // display went blank for good.
    const picked = pickTrafficInterface(asDefault('Tailscale'), LISTED, MONITORABLE);

    expect(picked).not.toBe('Tailscale');
    expect(MONITORABLE).toContain(picked);
    expect(picked).toBe('Eth 2.5G');
  });

  it('keeps the platform default when it can be read', () => {
    // The fix must not override a perfectly good default.
    expect(pickTrafficInterface(asDefault('Eth 2.5G'), LISTED, MONITORABLE)).toBe('Eth 2.5G');
  });

  it('prefers an interface that is up over one that merely has counters', () => {
    const listed = [iface('Eth 1G', false), iface('Eth 2.5G')];
    expect(pickTrafficInterface(null, listed, ['Eth 1G', 'Eth 2.5G'])).toBe('Eth 2.5G');
  });

  it('still returns something when nothing is monitorable', () => {
    // An honest "no traffic data" against a named interface beats an empty
    // status bar, so the old ordering remains the fallback.
    expect(pickTrafficInterface(asDefault('Tailscale'), LISTED, [])).toBe('Tailscale');
    expect(pickTrafficInterface(null, LISTED, [])).toBe('Tailscale');
  });

  it('falls back to a down interface with counters rather than nothing', () => {
    const listed = [iface('Eth 1G', false)];
    expect(pickTrafficInterface(null, listed, ['Eth 1G'])).toBe('Eth 1G');
  });

  it('returns null when there are no interfaces at all', () => {
    expect(pickTrafficInterface(null, [], [])).toBeNull();
  });
});
