// A discovered host must not be described as having answered when it did not.
//
// The GUI called every discover row a "Responded host". The core has always
// distinguished the two cases -- a probe reply means the host is there now, a
// neighbour-table entry means the OS spoke to it recently and it may since
// have left -- and the raw tab showed `"found_by": "neighbor"` one click
// away, while the primary view stated the opposite. On an ordinary LAN that
// was 5 rows in 24 confidently mislabelled.
//
// PRODUCT.md: "No wrong answers. The scanner never silently reports
// something false." design-direction.md: never "present a result as certain
// when the underlying probe failed."

import { describe, expect, it } from 'vitest';

import { columnsFor } from './columns';
import { detailLinesForRow } from './rowDetails';
import { buildRows } from './rows';
import type { ToolResult } from '../../types/app';

const discoverResult = (): ToolResult =>
  ({
    kind: 'discover',
    data: [
      { ip: '192.168.1.10', hostname: 'desk', mac: 'AA:BB:CC:DD:EE:FF', vendor: 'Acme', rtt_ms: 3, found_by: 'probe' },
      { ip: '192.168.1.42', hostname: null, mac: 'C0:35:32:1A:19:EF', vendor: 'Liteon', rtt_ms: null, found_by: 'neighbor' },
    ],
  }) as ToolResult;

describe('a discovered host describes how it was found', () => {
  it('does not claim a neighbour-table entry responded', () => {
    const rows = buildRows(discoverResult());
    const summary = detailLinesForRow(rows[1]).find((l) => l.label === 'Summary');

    expect(summary?.value).not.toMatch(/responded to a probe/i);
    expect(summary?.value).toMatch(/neighbour table/i);
  });

  it('still says so when the host did answer', () => {
    const rows = buildRows(discoverResult());
    const summary = detailLinesForRow(rows[0]).find((l) => l.label === 'Summary');

    expect(summary?.value).toMatch(/responded to a probe/i);
  });

  it('carries found_by onto the row instead of dropping it', () => {
    const rows = buildRows(discoverResult());

    expect(rows[0].data.found_by).toBe('probe');
    expect(rows[1].data.found_by).toBe('neighbor');
  });

  it('shows it in the table, not only in the detail pane', () => {
    // The detail pane needs a selected row. A column is what makes a stale
    // entry visible while scanning the list, which is where someone decides
    // whether a device is really there.
    const columns = columnsFor('discover', discoverResult(), buildRows(discoverResult()));

    expect(columns.map((c) => c.key)).toContain('found');
    expect(buildRows(discoverResult())[1].data.found).toMatch(/neighbour/i);
  });
});
