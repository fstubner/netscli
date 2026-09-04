// @vitest-environment jsdom
// Copying the command says that it worked.
//
// It used to say so only through an `interaction` toast, and those are off by
// default -- on purpose, so a new user is not met by a running commentary on
// their own clicks. The result was that the one action whose entire outcome
// is invisible, putting text on the clipboard, gave no sign at all at stock
// settings. Feedback on the button needs no setting to be on.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommandStrip } from './CommandStrip';

const button = () => screen.getByRole('button');

describe('CommandStrip', () => {
  it('marks itself copied when the copy succeeds', async () => {
    render(<CommandStrip command="netscli discover" onCopy={() => Promise.resolve(true)} />);
    expect(button().getAttribute('aria-label')).toBe('Copy command');

    fireEvent.click(button());

    await waitFor(() => expect(button().getAttribute('aria-label')).toBe('Copied'));
    expect(button().getAttribute('data-copied')).toBe('true');
    expect(button().getAttribute('data-tooltip')).toBe('Copied');
  });

  it('says nothing when the copy failed', async () => {
    render(<CommandStrip command="netscli discover" onCopy={() => Promise.resolve(false)} />);

    fireEvent.click(button());

    // Give the promise a turn to settle before asserting the absence.
    await Promise.resolve();
    expect(button().getAttribute('aria-label')).toBe('Copy command');
    expect(button().getAttribute('data-copied')).toBeNull();
  });

  it('reverts after the copied window', async () => {
    vi.useFakeTimers();
    try {
      render(<CommandStrip command="netscli discover" onCopy={() => Promise.resolve(true)} />);
      fireEvent.click(button());
      await vi.waitFor(() => expect(button().getAttribute('data-copied')).toBe('true'));

      vi.advanceTimersByTime(1500);

      await vi.waitFor(() => expect(button().getAttribute('data-copied')).toBeNull());
      expect(button().getAttribute('aria-label')).toBe('Copy command');
    } finally {
      vi.useRealTimers();
    }
  });
});
