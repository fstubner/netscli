// @vitest-environment jsdom
// A tool that cannot run looks the same wherever it is offered.
//
// It did not. The menu bar greyed packet capture and said why; this menu --
// the chevron beside the tabs, three inches away -- offered it as an ordinary
// item on a build that cannot capture. Whichever one a person happened to
// open decided whether they were told.

import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ToolCapabilityMap } from '../../tools/types';
import { TabToolMenu } from './TabToolMenu';

const ALL_AVAILABLE: ToolCapabilityMap = {} as ToolCapabilityMap;

function renderMenu(reasons?: Record<string, string>) {
  render(
    <TabToolMenu
      position={{ top: 0, left: 0, maxHeight: 400 }}
      setOpenMenu={vi.fn()}
      toolCapabilities={ALL_AVAILABLE}
      toolDisabledReasons={reasons}
      triggerRef={createRef<HTMLButtonElement>()}
      onAddToolTab={vi.fn()}
    />,
  );
}

const item = (label: string) => screen.getByRole('menuitem', { name: new RegExp(label) });

describe('TabToolMenu', () => {
  it('greys a tool that cannot run, and says why', () => {
    renderMenu({ pcap: 'This build has no packet capture.' });
    const capture = item('Packet Capture');
    expect(capture.className).toContain('muted');
    expect(capture.getAttribute('data-tooltip')).toContain('This build has no packet capture.');
  });

  it('leaves the others alone', () => {
    renderMenu({ pcap: 'This build has no packet capture.' });
    expect(item('Port Scan').className).not.toContain('muted');
    expect(item('DNS Lookup').getAttribute('data-tooltip')).toBeNull();
  });

  it('greys nothing when every tool can run', () => {
    renderMenu();
    expect(item('Packet Capture').className).not.toContain('muted');
  });

  // Greyed, not removed, and still clickable: the pane behind the entry
  // carries the setup instructions, so an inert item would take away the one
  // place that says how to fix what it is greyed for. Same reasoning as
  // menuItems.ts.
  it('keeps a greyed tool clickable', () => {
    renderMenu({ pcap: 'This build has no packet capture.' });
    expect((item('Packet Capture') as HTMLButtonElement).disabled).toBe(false);
  });
});
