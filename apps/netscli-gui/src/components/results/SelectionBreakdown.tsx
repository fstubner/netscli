import { renderValue } from '../../tools/presentation';
import type { ResultColumn, ResultRow } from '../../tools/types';
import { DetailList } from './DetailList';

export function SelectionBreakdown({ columns, rows }: { columns: ResultColumn[]; rows: ResultRow[] }) {
  const lines = selectionBreakdownLines(rows, columns);
  if (lines.length === 0) return null;

  return (
    <div className="selection-breakdown">
      <span className="selection-breakdown-title">Selection Breakdown</span>
      <DetailList lines={lines} />
    </div>
  );
}

function selectionBreakdownLines(rows: ResultRow[], columns: ResultColumn[]): Array<{ label: string; value: string; muted?: boolean }> {
  if (rows.length === 0) return [];

  if (rows.some((row) => row.port)) {
    const ports = rows
      .map((row) => row.port?.port)
      .filter((port): port is number => typeof port === 'number')
      .map(String);
    const services = topCounts(rows.map((row) => row.port?.service ?? 'tcp').filter(isUsefulValue));
    return [
      { label: 'Ports', value: formatSample(ports, 14), muted: ports.length === 0 },
      { label: 'Services', value: services || '-', muted: !services },
    ];
  }

  const valuesFor = (key: string) => rows.map((row) => row.data[key] == null ? '' : String(row.data[key])).filter(isUsefulValue);
  const ipValues = valuesFor('ip');
  const vendorValues = valuesFor('vendor');
  const interfaceValues = valuesFor('interface');
  const recordTypes = valuesFor('record_type');
  const addressValues = valuesFor('addresses');

  if (ipValues.length > 0 || vendorValues.length > 0 || interfaceValues.length > 0) {
    const knownVendors = vendorValues.length;
    const unknownVendors = Math.max(0, rows.length - knownVendors);
    return [
      {
        label: 'Vendor Coverage',
        value: `${knownVendors} known, ${unknownVendors} unknown`,
        muted: knownVendors === 0,
      },
      { label: 'Top Vendors', value: topCounts(vendorValues) || '-', muted: vendorValues.length === 0 },
      { label: 'Interfaces', value: topCounts(interfaceValues) || '-', muted: interfaceValues.length === 0 },
      { label: 'IP Sample', value: formatSample(ipValues, 10), muted: ipValues.length === 0 },
    ];
  }

  if (recordTypes.length > 0) {
    return [
      { label: 'Record Types', value: topCounts(recordTypes) || '-', muted: recordTypes.length === 0 },
      { label: 'Value Sample', value: formatSample(valuesFor('value'), 6), muted: valuesFor('value').length === 0 },
    ];
  }

  if (addressValues.length > 0) {
    return [
      { label: 'Interfaces', value: formatSample(valuesFor('interface'), 8), muted: valuesFor('interface').length === 0 },
      { label: 'Addresses', value: formatSample(addressValues, 4), muted: addressValues.length === 0 },
    ];
  }

  const sampleColumn = columns.find((column) => rows.some((row) => isUsefulValue(renderValue(row.data[column.key]))));
  if (!sampleColumn) return [];
  return [
    {
      label: `${sampleColumn.label} Sample`,
      value: formatSample(valuesFor(sampleColumn.key), 8),
    },
  ];
}

function topCounts(values: string[], limit = 4): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => `${value}: ${count}`)
    .join(', ');
}

function formatSample(values: string[], limit: number): string {
  if (values.length === 0) return '-';
  const uniqueValues = Array.from(new Set(values));
  if (uniqueValues.length <= limit) return uniqueValues.join(', ');
  return `${uniqueValues.slice(0, limit).join(', ')} +${uniqueValues.length - limit} more`;
}

function isUsefulValue(value: string | undefined): value is string {
  return Boolean(value && value.trim() && value !== '-');
}
