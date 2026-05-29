import { describe, expect, it } from 'vitest';

import { createTab } from '../tools/registry';
import { guardForOperation } from './operationGuards';

describe('operation guards', () => {
  it('does not warn for normal private discovery ranges', () => {
    const tab = createTab('discover');
    tab.form.subnet = '192.168.1.0/24';

    expect(guardForOperation(tab)).toBeNull();
  });

  it('warns before large private sweeps', () => {
    const tab = createTab('sweep');
    tab.form.subnet = '10.0.0.0/16';
    tab.form.ports = '22,80,443';

    expect(guardForOperation(tab)?.title).toBe('Confirm Large Operation');
  });

  it('warns before public range discovery', () => {
    const tab = createTab('discover');
    tab.form.subnet = '8.8.0.0/20';

    expect(guardForOperation(tab)?.title).toBe('Confirm Public Range');
  });
});
