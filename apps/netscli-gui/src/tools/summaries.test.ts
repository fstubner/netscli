import { describe, expect, it } from 'vitest';

import { resultSummary } from './presentation';

describe('resultSummary — packet capture truncation', () => {
  /**
   * The core sets `packets_truncated` on a capture and `truncated` on a
   * parse, and neither was read anywhere in the GUI. Opening a
   * 20,000-packet file with the default 1,000 limit showed 1,000 rows under
   * a status bar reading "20000 packets" — no indication the view was cut
   * off, while Export CSV wrote only the loaded rows.
   */
  const packets = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i })) as never[];

  it('says how many of how many when a parsed capture is truncated', () => {
    const summary = resultSummary({
      kind: 'pcap',
      data: { file_path: 'x.pcap', link_type: 1, total_packets: 20000, packets: packets(1000), truncated: true },
    } as never);
    expect(summary).toBe('1000 of 20000 packets shown');
  });

  it('says how many of how many when a live capture is truncated', () => {
    const summary = resultSummary({
      kind: 'pcap',
      data: { file_path: 'x.pcap', duration: { secs: 5, nanos: 0 }, packets_captured: 8000, packets: packets(1000), packets_truncated: true },
    } as never);
    expect(summary).toBe('1000 of 8000 packets shown');
  });

  it('reports a plain total when nothing was dropped', () => {
    const summary = resultSummary({
      kind: 'pcap',
      data: { file_path: 'x.pcap', link_type: 1, total_packets: 42, packets: packets(42), truncated: false },
    } as never);
    expect(summary).toBe('42 packets');
  });
});
