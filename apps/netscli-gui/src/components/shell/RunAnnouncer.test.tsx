// @vitest-environment jsdom
//
// What a screen reader hears while a run is going. Only the live region's text
// is checked, because that is the whole of what reaches the user: if the region
// does not change, nothing is spoken.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTab } from '../../tools/registry';
import type { OperationProgressState, WorkspaceTab } from '../../tools/types';
import { RunAnnouncer } from './RunAnnouncer';

const scan = createTab('scan');

function running(progress?: Partial<OperationProgressState>): WorkspaceTab {
  return {
    ...scan,
    busy: true,
    progress: { kind: 'scan', completed: 0, total: 0, found: 0, ...progress },
  };
}

function spoken() {
  return screen.getByRole('status').textContent;
}

describe('RunAnnouncer', () => {
  it('is a polite live region that exists before anything is said', () => {
    render(<RunAnnouncer tab={scan} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(spoken()).toBe('');
  });

  it('announces the start and the end of a run, with its summary', () => {
    const { rerender } = render(<RunAnnouncer tab={scan} />);

    rerender(<RunAnnouncer tab={running()} />);
    expect(spoken()).toBe('Port Scan started');

    const result = {
      kind: 'scan',
      data: [
        { port: 22, open: true },
        { port: 80, open: false },
      ],
    } as never;
    rerender(<RunAnnouncer tab={{ ...scan, result }} />);
    expect(spoken()).toBe('Port Scan complete. 2 results - 1 open');
  });

  it('says a stopped run stopped, and leaves a failed run to the error strip', () => {
    const { rerender } = render(<RunAnnouncer tab={scan} />);
    rerender(<RunAnnouncer tab={running()} />);
    rerender(<RunAnnouncer tab={scan} />);
    expect(spoken()).toBe('Port Scan stopped');

    rerender(<RunAnnouncer tab={running()} />);
    rerender(<RunAnnouncer tab={{ ...scan, error: 'Connection refused' }} />);
    // Still the start message: no second voice for the same failure.
    expect(spoken()).toBe('Port Scan started');
  });

  it('reports progress a quarter at a time, not on every event', () => {
    const { rerender } = render(<RunAnnouncer tab={scan} />);
    rerender(<RunAnnouncer tab={running({ completed: 0, total: 1000 })} />);

    const heard: string[] = [];
    for (let completed = 10; completed <= 900; completed += 10) {
      rerender(<RunAnnouncer tab={running({ completed, total: 1000 })} />);
      const text = spoken() ?? '';
      if (heard[heard.length - 1] !== text) heard.push(text);
    }
    expect(heard).toEqual([
      'Port Scan started',
      'Port Scan, 25% complete',
      'Port Scan, 50% complete',
      'Port Scan, 75% complete',
    ]);
  });

  it('keeps quiet when the person switches to another tab', () => {
    const other = createTab('ping');
    const { rerender } = render(<RunAnnouncer tab={scan} />);
    // The tab shown now is mid-run, which is not something that just happened.
    rerender(<RunAnnouncer tab={{ ...other, busy: true }} />);
    expect(spoken()).toBe('');
  });

  it('does not turn a trace into a percentage', () => {
    const trace = createTab('trace');
    const { rerender } = render(<RunAnnouncer tab={trace} />);
    rerender(<RunAnnouncer tab={{ ...trace, busy: true }} />);
    rerender(
      <RunAnnouncer
        tab={{
          ...trace,
          busy: true,
          progress: { kind: 'trace', completed: 12, total: 30, found: 0 },
        }}
      />,
    );
    expect(spoken()).toBe('Trace Route started');
  });
});
