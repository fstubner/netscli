import { describe, expect, it } from 'vitest';

import { createTab } from '../tools/registry';
import type { DefaultInterfaceInfo, InterfaceInfo } from '../types/netscli';
import { applyContextDefaults, preferredCaptureInterface, subnetFromInterfaces } from './networkDefaults';

function iface(name: string, ips: string[], isUp = true, isLoopback = false): InterfaceInfo {
  return {
    name,
    ips,
    is_up: isUp,
    is_loopback: isLoopback,
  };
}

describe('network defaults', () => {
  it('does not use host-only or non-LAN interface addresses for discovery defaults', () => {
    const defaultInterface: DefaultInterfaceInfo = {
      name: 'Tailscale',
      ips: ['100.106.71.95/32', 'fd7a:115c:a1e0::8833:475f/128'],
      is_up: true,
    };

    expect(subnetFromInterfaces(defaultInterface, [iface('Tailscale', defaultInterface.ips)])).toBe('192.168.1.0/24');
  });

  it('does not use virtual adapter private ranges for discovery defaults', () => {
    const docker = iface('vEthernet (WSL)', ['172.27.96.1/20']);
    const tailscale: DefaultInterfaceInfo = {
      name: 'Tailscale',
      ips: ['100.106.71.95/32'],
      is_up: true,
    };

    expect(subnetFromInterfaces(tailscale, [docker])).toBe('172.27.96.0/20');
  });

  it('prefers a usable private LAN subnet over a Tailscale host route', () => {
    const defaultInterface: DefaultInterfaceInfo = {
      name: 'Tailscale',
      ips: ['100.106.71.95/32'],
      is_up: true,
    };

    expect(
      subnetFromInterfaces(defaultInterface, [
        iface('Tailscale', ['100.106.71.95/32']),
        iface('Eth 2.5G', ['192.168.1.131/24']),
      ]),
    ).toBe('192.168.1.0/24');
  });

  it('patches discover and sweep tabs only while the subnet field is blank', () => {
    const interfaces = [iface('Eth 2.5G', ['192.168.1.131/24'])];
    const defaultInterface: DefaultInterfaceInfo = { name: 'Eth 2.5G', ips: ['192.168.1.131/24'], is_up: true };

    const discover = applyContextDefaults(createTab('discover'), defaultInterface, null, interfaces);
    expect(discover.form.subnet).toBe('192.168.1.0/24');

    const sweep = createTab('sweep');
    sweep.form.subnet = '10.0.0.0/24';
    expect(applyContextDefaults(sweep, defaultInterface, null, interfaces).form.subnet).toBe('10.0.0.0/24');
  });

  it('uses a physical capture interface before saved virtual traffic monitors', () => {
    const interfaces = [
      iface('Tailscale', ['100.106.71.95/32']),
      iface('Eth 2.5G', ['192.168.1.131/24']),
    ];
    const defaultInterface: DefaultInterfaceInfo = {
      name: 'Tailscale',
      ips: ['100.106.71.95/32'],
      is_up: true,
    };

    expect(preferredCaptureInterface('Tailscale', defaultInterface, interfaces)).toBe('Eth 2.5G');
    expect(preferredCaptureInterface(null, defaultInterface, interfaces)).toBe('Eth 2.5G');

    const pcap = applyContextDefaults(createTab('pcap'), defaultInterface, null, interfaces);
    expect(pcap.form.interface).toBe('Eth 2.5G');
  });

  it('falls back to an up physical interface for packet capture when the saved monitor is gone', () => {
    const interfaces = [iface('Eth 2.5G', ['192.168.1.131/24'])];
    const defaultInterface: DefaultInterfaceInfo = {
      name: 'Tailscale',
      ips: ['100.106.71.95/32'],
      is_up: true,
    };

    expect(preferredCaptureInterface('Missing', defaultInterface, interfaces)).toBe('Eth 2.5G');
  });
});
