import type { buildRows } from '../tools/presentation';

type InterfaceRow = ReturnType<typeof buildRows>[number];

export function enrichInterfaceRows(
  rows: ReturnType<typeof buildRows>,
  defaultName: string | undefined,
  selectedName: string | null,
): ReturnType<typeof buildRows> {
  if (rows.length === 0 || rows[0]?.kind !== 'interfaces') return rows;
  const activeName = selectedName || defaultName;
  return rows.map((row) => enrichInterfaceRow(row as InterfaceRow, defaultName, activeName));
}

function enrichInterfaceRow(
  row: InterfaceRow,
  defaultName: string | undefined,
  activeName: string | undefined,
): InterfaceRow {
  const name = String(row.data.name ?? '');
  const labels = [
    activeName && name === activeName ? 'selected' : '',
    defaultName && name === defaultName ? 'default' : '',
  ].filter(Boolean);
  const data = { ...row.data, app: labels.join(', ') };
  return {
    ...row,
    data,
    searchText: Object.values(data).join(' ').toLowerCase(),
  };
}
