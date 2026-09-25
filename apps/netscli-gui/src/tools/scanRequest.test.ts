import { describe, expect, it } from 'vitest';

import { DEFAULT_PORTS } from './registry';
import { applyFormChange, DEFAULT_UDP_PORTS } from './scanRequest';

describe('applyFormChange', () => {
  const scanForm = { host: '127.0.0.1', ports: DEFAULT_PORTS, protocol: 'TCP' };

  it('swaps the TCP default ports for the UDP ones when switching to UDP, and back', () => {
    const udp = applyFormChange('scan', scanForm, 'protocol', 'UDP');
    expect(udp.ports).toBe(DEFAULT_UDP_PORTS);
    expect(applyFormChange('scan', udp, 'protocol', 'TCP').ports).toBe(DEFAULT_PORTS);
  });

  it('leaves a port list the user typed alone', () => {
    const typed = { ...scanForm, ports: '22,3389' };
    expect(applyFormChange('scan', typed, 'protocol', 'UDP').ports).toBe('22,3389');
  });

  it('only touches the port list on a Port Scan protocol change', () => {
    expect(applyFormChange('scan', scanForm, 'host', '10.0.0.1').ports).toBe(DEFAULT_PORTS);
    expect(applyFormChange('inspect', { ports: DEFAULT_PORTS }, 'protocol', 'UDP').ports).toBe(DEFAULT_PORTS);
  });
});
