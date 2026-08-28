// Which columns a result gets, and how much width each is allowed to take.
//
// Split out of presentation.test.ts alongside presentation.rows.test.ts; this
// is the column half of that file's stated next split.

import { describe, expect, it } from 'vitest';

import { columnsFor } from './presentation';
import type { ToolResult } from '../types/app';

describe('column selection', () => {
  it('keeps DNS record type compact and leaves value column to fill the table', () => {
    const columns = columnsFor('dns', null);
    expect(columns[0]).toMatchObject({ key: 'record_type', width: 72 });
    expect(columns[1]).toMatchObject({ key: 'value', grow: true });
    expect(columns.map((column) => column.key)).toContain('ttl');
    expect(columns.map((column) => column.key)).toContain('resolver');
  });

  it('does not let empty optional columns consume the main table width', () => {
    const discoverWithoutHostnames: ToolResult = {
      kind: 'discover',
      data: [
        {
          ip: '192.168.1.125',
          hostname: '',
          mac: '00:17:88:6E:6C:5C',
          vendor: 'Philips Lighting BV',
        },
      ],
    };
    const emptyHostnameColumns = columnsFor('discover', discoverWithoutHostnames);
    expect(emptyHostnameColumns.find((column) => column.key === 'hostname')).toMatchObject({
      width: 130,
    });
    expect(emptyHostnameColumns.find((column) => column.key === 'vendor')).toMatchObject({
      grow: true,
    });

    const discoverWithHostname: ToolResult = {
      kind: 'discover',
      data: [
        {
          ip: '192.168.1.125',
          hostname: 'lamp.local',
          mac: '00:17:88:6E:6C:5C',
          vendor: 'Philips Lighting BV',
        },
      ],
    };
    expect(columnsFor('discover', discoverWithHostname).find((column) => column.key === 'hostname')).toMatchObject({
      grow: true,
    });
  });
});
