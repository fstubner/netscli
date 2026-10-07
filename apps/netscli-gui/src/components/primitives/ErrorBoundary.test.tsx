// @vitest-environment jsdom
//
// The screen a crashed window turns into. Nothing exercised it before, and it
// is the one screen that cannot lean on the rest of the app: no menu, no
// preferences, and none of the styles `.container` supplies.

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('service.addresses.join is not a function');
}

beforeEach(() => {
  // React reports the error it caught; the test does not need the noise.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('says what happened and how to recover', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(screen.getByText('service.addresses.join is not a function')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('keeps a way to move and close a window that has no title bar', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    for (const name of ['Minimize', 'Maximize', 'Close']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('is drawn inside .container, which is where the colour tokens are defined', () => {
    // Outside it the text colour comes from the OS theme on a page that is
    // always dark: black on near-black for anyone on a light theme. jsdom has
    // no stylesheet, so the structure is what can be checked.
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary').closest('.container')).not.toBeNull();
  });
});
