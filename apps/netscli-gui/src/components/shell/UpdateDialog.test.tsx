// @vitest-environment jsdom
//
// The update dialog is the only place a download is started, so the tests
// here are about what the user can and cannot do once it is: nothing closes
// it mid-install, a failure says what happened and offers the release page,
// and an install that "succeeds" without restarting is not reported as fine.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UpdateDialog } from './UpdateDialog';

function renderDialog(overrides: Partial<Parameters<typeof UpdateDialog>[0]> = {}) {
  const props = {
    currentVersion: '0.3.4',
    version: '0.3.5',
    notes: 'Faster discovery.',
    onInstall: vi.fn(() => new Promise<void>(() => {})),
    onLater: vi.fn(),
    onSkip: vi.fn(),
    onOpenReleasePage: vi.fn(),
    ...overrides,
  };
  render(<UpdateDialog {...props} />);
  return props;
}

describe('UpdateDialog', () => {
  it('names both versions and shows the release notes', () => {
    renderDialog();
    expect(screen.getByRole('heading').textContent).toContain('0.3.5');
    expect(screen.getByText(/You have 0.3.4/)).toBeTruthy();
    expect(screen.getByTestId('update-notes').textContent).toBe('Faster discovery.');
  });

  it('installs nothing until asked', () => {
    const props = renderDialog();
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it('locks every way out while the install runs', async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Downloading/));
    for (const name of ['Install and restart', 'Later', 'Skip this version']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.keyDown(screen.getByTestId('update-dialog'), { key: 'Escape' });
    expect(props.onLater).not.toHaveBeenCalled();
  });

  it('reports download progress as it arrives', async () => {
    renderDialog({
      onInstall: vi.fn((onProgress: (f: number | null) => void) => {
        onProgress(0.42);
        return new Promise<void>(() => {});
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Downloading… 42%'));
  });

  it('explains a failure and offers the release page instead', async () => {
    const props = renderDialog({
      onInstall: vi.fn(() => Promise.reject('signature verification failed')),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'The update could not be installed: signature verification failed',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open release page' }));
    expect(props.onOpenReleasePage).toHaveBeenCalled();
  });

  it('does not call a missing restart a success', async () => {
    // installUpdate resolving means the restart never happened.
    renderDialog({ onInstall: vi.fn(() => Promise.resolve()) });
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Close and reopen/));
  });

  it('skips and defers as separate choices', () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }));
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(props.onLater).not.toHaveBeenCalled();
  });
});
