import { describe, expect, it, vi } from 'vitest';

import { toolItemFactory } from './menuItems';

describe('tool menu items', () => {
  it('is a plain entry when the tool can run', () => {
    const item = toolItemFactory(vi.fn())('pcap');

    expect(item.muted).toBe(false);
    expect(item.tooltip).toBeUndefined();
  });

  it('is greyed and says why when the tool cannot run', () => {
    const item = toolItemFactory(vi.fn(), {
      pcap: 'Packet Capture needs Npcap/libpcap before it can run.',
    })('pcap');

    expect(item.muted).toBe(true);
    expect(item.tooltip).toContain('Npcap');
  });

  it('stays clickable while greyed', () => {
    // Not an oversight. The pane behind this entry carries the setup
    // instructions and the link to them, so a genuinely inert entry would
    // remove the only place that explains how to fix what it is greyed for
    // -- which is the state the app was in when people reported finding no
    // trace of packet capture and no explanation.
    const onAddTab = vi.fn();
    const item = toolItemFactory(onAddTab, { pcap: 'Needs Npcap.' })('pcap');

    expect(item.disabled).toBeUndefined();
    item.action?.();
    expect(onAddTab).toHaveBeenCalledWith('pcap');
  });

  it('leaves other tools alone when one is unavailable', () => {
    const make = toolItemFactory(vi.fn(), { pcap: 'Needs Npcap.' });

    expect(make('scan').muted).toBe(false);
    expect(make('mdns').tooltip).toBeUndefined();
  });
});
