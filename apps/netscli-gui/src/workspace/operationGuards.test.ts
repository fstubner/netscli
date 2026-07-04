import { describe, expect, it } from 'vitest';

import { createTab } from '../tools/registry';
import { guardForOperation } from './operationGuards';

describe('operation guards', () => {
  it('does not warn for normal private discovery ranges', () => {
    const tab = createTab('discover');
    tab.form.subnet = '192.168.1.0/24';

    expect(guardForOperation(tab)).toBeNull();
  });

  it('does not treat local-only ranges as public', () => {
    const loopback = createTab('discover');
    loopback.form.subnet = '127.0.0.0/30';
    expect(guardForOperation(loopback)).toBeNull();

    const cgnat = createTab('discover');
    cgnat.form.subnet = '100.64.0.0/24';
    expect(guardForOperation(cgnat)).toBeNull();
  });

  it('warns before large private sweeps', () => {
    const tab = createTab('sweep');
    tab.form.subnet = '10.0.0.0/16';
    tab.form.ports = '22,80,443';

    expect(guardForOperation(tab)?.title).toBe('Confirm Large Operation');
  });

  it('warns before public range discovery', () => {
    const tab = createTab('discover');
    tab.form.subnet = '8.8.8.0/30';

    expect(guardForOperation(tab)?.title).toBe('Confirm Public Range');
  });

  it('warns before large IPv6 discovery ranges', () => {
    const tab = createTab('discover');
    tab.form.subnet = 'fd12:3456:789a::/48';

    expect(guardForOperation(tab)?.title).toBe('Confirm Large Operation');
  });

  it('uses the default port count when estimating blank sweep port probes', () => {
    const tab = createTab('sweep');
    tab.form.subnet = '10.0.0.0/20';
    tab.form.ports = '';

    expect(guardForOperation(tab)?.title).toBe('Confirm Large Operation');
  });
});
