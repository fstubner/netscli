import { describe, expect, it } from 'vitest';

import { preferredStatusAddress } from './address';

describe('preferredStatusAddress', () => {
  it('prefers IPv4 by default while preserving IPv6 as fallback', () => {
    const ips = ['fd7a:115c:a1e0::8833:475f/128', '192.168.1.10/24'];

    expect(preferredStatusAddress(ips, 'ipv4')).toBe('192.168.1.10/24');
    expect(preferredStatusAddress(['fd7a:115c:a1e0::8833:475f/128'], 'ipv4')).toBe(
      'fd7a:115c:a1e0::8833:475f/128',
    );
  });

  it('can prefer IPv6 when requested', () => {
    const ips = ['192.168.1.10/24', 'fd7a:115c:a1e0::8833:475f/128'];

    expect(preferredStatusAddress(ips, 'ipv6')).toBe('fd7a:115c:a1e0::8833:475f/128');
  });

  // Real interface data from a Windows machine, where the OS order buries the
  // only address anyone would act on. The picker used to render ips[0] and so
  // showed a /128 for every one of these.
  it('reaches past the OS ordering for the address that matters', () => {
    const tailscale = [
      'fd7a:115c:a1e0::8833:475f/128',
      'fe80::9f86:6963:9a47:35cb/128',
      '100.106.71.95/32',
    ];

    expect(preferredStatusAddress(tailscale, 'ipv4')).toBe('100.106.71.95/32');
  });

  it('falls back to IPv6 when an interface genuinely has no IPv4', () => {
    const ipv6Only = [
      '2001:bb6:d774:1300:973a:de84:a20a:2d90/128',
      'fe80::cc89:6f06:3ddc:8522/128',
    ];

    expect(preferredStatusAddress(ipv6Only, 'ipv4')).toBe(
      '2001:bb6:d774:1300:973a:de84:a20a:2d90/128',
    );
  });

  it('returns null for an interface with no addresses at all', () => {
    expect(preferredStatusAddress([], 'ipv4')).toBeNull();
  });
});
