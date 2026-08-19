import { formatNumber } from './values';
export interface TraceHopRow {
  hop: number;
  status: string;
  best: string;
  avg: string;
  worst: string;
  address: string;
  line: string;
}

export function parseTraceLine(line: string): TraceHopRow | null {
  const windows = line.match(
    /^\s*(\d+)\s+((?:<\d+|\d+)\s*ms|\*)\s+((?:<\d+|\d+)\s*ms|\*)\s+((?:<\d+|\d+)\s*ms|\*)\s+(.+)$/i,
  );
  if (windows) {
    const samples = [windows[2], windows[3], windows[4]].map(formatTraceSample);
    const address = windows[5].trim();
    const timeout = samples.every((sample) => sample === '*');
    return {
      hop: Number(windows[1]),
      status: timeout ? 'timeout' : 'reply',
      best: timeout ? '-' : traceBest(samples),
      avg: timeout ? '-' : traceAverage(samples),
      worst: timeout ? '-' : traceWorst(samples),
      address: timeout ? 'Request timed out' : address,
      line,
    };
  }

  const unix = line.match(/^\s*(\d+)\s+(.+)$/);
  if (!unix) return null;
  const rest = unix[2].trim();
  if (/^(tracing route|trace complete|over a maximum)/i.test(rest)) return null;
  const timeout = /^\*([\s*]+)?$/.test(rest);
  if (timeout) {
    return {
      hop: Number(unix[1]),
      status: 'timeout',
      best: '-',
      avg: '-',
      worst: '-',
      address: 'Request timed out',
      line,
    };
  }
  const samples = Array.from(rest.matchAll(/(<\d+|\d+(?:\.\d+)?)\s*ms/gi)).map((match) => formatTraceSample(match[0]));
  const address = rest.replace(/\s+(?:<\d+|\d+(?:\.\d+)?)\s*ms/gi, '').trim();
  return {
    hop: Number(unix[1]),
    status: samples.length > 0 ? 'reply' : 'note',
    best: samples.length > 0 ? traceBest(samples) : '-',
    avg: samples.length > 0 ? traceAverage(samples) : '-',
    worst: samples.length > 0 ? traceWorst(samples) : '-',
    address: address || rest,
    line,
  };
}

function formatTraceSample(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function traceSampleNumber(value: string): number | null {
  const match = value.match(/<?(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function traceBest(samples: string[]): string {
  const numbers = samples.map(traceSampleNumber).filter((value): value is number => value != null);
  return numbers.length > 0 ? `${Math.min(...numbers)} ms` : '-';
}

function traceWorst(samples: string[]): string {
  const numbers = samples.map(traceSampleNumber).filter((value): value is number => value != null);
  return numbers.length > 0 ? `${Math.max(...numbers)} ms` : '-';
}

function traceAverage(samples: string[]): string {
  const numbers = samples.map(traceSampleNumber).filter((value): value is number => value != null);
  if (numbers.length === 0) return '-';
  const avg = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  return `${formatNumber(avg)} ms`;
}

