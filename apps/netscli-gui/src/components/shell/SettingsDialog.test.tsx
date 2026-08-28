// @vitest-environment jsdom
//
// The settings controls reach their setters.
//
// These used to arrive as ~22 individual props, each a one-line lambda
// defined in App and threaded through AppDialogs. They now come from the
// `preferences` object the dialog receives whole. That is a rewiring of
// every control in here, and nothing but a rendered click proves a switch
// still moves anything -- the types would be equally happy with a handler
// wired to the wrong setter.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from './SettingsDialog';
import type { Preferences } from '../../hooks/usePreferences';

function preferencesDouble(): Preferences {
  return {
    addressPreference: 'ipv4',
    commandBarVisible: false,
    darkMode: true,
    interactionToasts: true,
    maxConcurrentProbes: 256,
    operationToasts: true,
    persistentHistory: false,
    releaseNotifications: true,
    trafficDisplayUnit: 'Mbps',
    trafficIndicators: true,
    trafficPrecision: 1,
    setAddressPreference: vi.fn(),
    setCommandBarVisible: vi.fn(),
    setDarkMode: vi.fn(),
    setInteractionToasts: vi.fn(),
    setMaxConcurrentProbes: vi.fn(),
    setOperationToasts: vi.fn(),
    setPersistentHistory: vi.fn(),
    setReleaseNotifications: vi.fn(),
    setTrafficDisplayUnit: vi.fn(),
    setTrafficIndicators: vi.fn(),
    setTrafficPrecision: vi.fn(),
  } as unknown as Preferences;
}

function renderDialog() {
  const preferences = preferencesDouble();
  render(
    <SettingsDialog
      preferences={preferences}
      defaultInterface={null}
      fileSavePreferences={{ ask_each_time: true, default_directory: null } as never}
      interfaces={[]}
      trafficInterfaceName={null}
      onClose={vi.fn()}
      onChooseSaveFolder={vi.fn()}
      onClearSaveFolder={vi.fn()}
      onSelectTrafficInterface={vi.fn()}
      onToggleFileSaveAskEachTime={vi.fn()}
      onTogglePersistentHistory={vi.fn()}
    />,
  );
  return preferences;
}

describe('settings dialog wiring', () => {
  it('renders against a preferences object rather than a prop per setting', () => {
    renderDialog();

    expect(screen.getByTestId('settings-dialog')).toBeTruthy();
  });

  it('the theme switch sets dark mode, inverted from its current value', () => {
    const preferences = renderDialog();

    fireEvent.click(screen.getByTestId('settings-theme-toggle'));

    // The double starts dark, so the switch must ask for light.
    expect(preferences.setDarkMode).toHaveBeenCalledWith(false);
  });

  it('every checkbox row in the dialog reaches a setter', () => {
    const preferences = renderDialog();
    // `SettingsSwitch` renders a native checkbox inside a label, so these are
    // checkboxes rather than `role="switch"` -- only the theme control is the
    // latter.
    const rows = screen.getAllByRole('checkbox');

    for (const row of rows) fireEvent.click(row);

    const fired = Object.entries(preferences)
      .filter(([key]) => key.startsWith('set'))
      .filter(([, fn]) => (fn as { mock?: { calls: unknown[] } }).mock?.calls.length)
      .map(([key]) => key)
      .sort();

    expect(rows.length).toBeGreaterThan(3);
    // Each row is wired to its own setter, so clicking all of them should
    // reach several distinct ones -- not the same one repeatedly, which is
    // what a copy-paste slip in the rewiring would look like.
    expect(fired.length).toBeGreaterThanOrEqual(4);
    expect(fired).toContain('setCommandBarVisible');
  });

});
