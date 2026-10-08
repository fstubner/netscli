// @vitest-environment jsdom
//
// The licenses open in place of the About dialog. Both dialogs listen for
// Escape, so these pin that Escape on the licenses goes back to About and
// does not close both at once.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AboutDialog } from './AboutDialog';

vi.mock('../../services/netscli', () => ({
  getThirdPartyNotices: vi.fn(() => Promise.resolve('react 19.3.0\nMIT License')),
}));

describe('AboutDialog', () => {
  it('shows the third-party licenses and goes back on Escape', async () => {
    const onClose = vi.fn();
    render(<AboutDialog appVersion="0.3.5" onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /Third-party licenses/ }));
    expect((await screen.findByText(/react 19\.3\.0/)).textContent).toContain('MIT License');
    expect(screen.queryByTestId('about-dialog')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('about-dialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
