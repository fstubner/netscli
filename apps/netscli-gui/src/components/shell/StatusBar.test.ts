import { describe, expect, it } from 'vitest';

import { preferredStatusAddress } from './StatusBar';

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
});
