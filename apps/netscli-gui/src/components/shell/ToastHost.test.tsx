// @vitest-environment jsdom
//
// The update toast has two jobs depending on the install. Where the app can
// update itself it opens the update dialog; everywhere else it opens the
// release page, as it always did. Getting these crossed is invisible in
// review: both are one click on the same toast.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/externalLinks', () => ({
  openAllowedExternalUrl: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../services/updater', () => ({ installUpdate: vi.fn() }));

const { openAllowedExternalUrl } = await import('../../services/externalLinks');
const { ToastHost } = await import('./ToastHost');

const RELEASE = 'https://github.com/fstubner/netscli/releases/tag/v0.4.0';

function updates(overrides = {}) {
  return {
    pendingUpdate: null,
    dialogOpen: false,
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    skipVersion: vi.fn(),
    ...overrides,
  };
}

function renderToast(opensUpdateDialog: boolean, releaseUpdates = updates()) {
  render(
    <ToastHost
      appVersion="0.3.4"
      dismissToast={vi.fn()}
      setActiveTabId={vi.fn()}
      toast={{
        id: 't',
        message: 'Update available: v0.4.0',
        kind: 'update',
        persistent: true,
        actionUrl: RELEASE,
        releaseVersion: '0.4.0',
        opensUpdateDialog,
      }}
      updates={releaseUpdates}
    />,
  );
  return releaseUpdates;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(openAllowedExternalUrl).mockClear();
});

describe('ToastHost update toast', () => {
  it('opens the update dialog where the app can install the update', () => {
    const releaseUpdates = renderToast(true);
    fireEvent.click(screen.getByTestId('toast'));

    expect(releaseUpdates.openDialog).toHaveBeenCalledTimes(1);
    expect(openAllowedExternalUrl).not.toHaveBeenCalled();
    // "Later" has to bring the notice back next launch.
    expect(window.localStorage.getItem('netscli-dismissed-release-version')).toBeNull();
  });

  it('opens the release page where it cannot', () => {
    const releaseUpdates = renderToast(false);
    fireEvent.click(screen.getByTestId('toast'));

    expect(openAllowedExternalUrl).toHaveBeenCalledWith(RELEASE);
    expect(releaseUpdates.openDialog).not.toHaveBeenCalled();
  });

  it('labels the two actions differently', () => {
    renderToast(true);
    expect(screen.getByTestId('toast').getAttribute('aria-label')).toContain('View update');
  });

  it('renders the dialog once it is open and an update is pending', () => {
    renderToast(
      true,
      updates({ dialogOpen: true, pendingUpdate: { version: '0.4.0', body: 'notes' } }),
    );
    expect(screen.getByTestId('update-dialog')).toBeTruthy();
  });
});
