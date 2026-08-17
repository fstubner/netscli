import { describe, expect, it } from 'vitest';

import { availableToolKinds, LOOKUP_TOOL_KINDS } from './registry';
import type { ToolCapabilityMap } from './types';

/**
 * Packet Capture must stay reachable on builds without the feature.
 *
 * This is the behaviour three documents already specified and the app did
 * not: `docs/RELEASE.md` says the GUI "may still show the Packet Capture
 * tool, but it must present setup guidance and remain non-runnable", and the
 * install docs say the same. The menu filtered it out instead, and because no
 * published installer ships `--features pcap`, that was what every real user
 * got — the feature simply absent, with nothing explaining why.
 *
 * The guidance pane and the disabled Run button are both keyed on the
 * capability separately, so keeping the entry visible is safe. This test
 * exists because the regression is silent: hiding a menu item again would
 * break no other test and show up only as a missing feature.
 */
describe('availableToolKinds', () => {
  it('keeps Packet Capture listed when the build has no pcap support', () => {
    // What useTauriRuntimeState produces on a published build: mdns compiled,
    // pcap absent from the map entirely.
    const capabilities: ToolCapabilityMap = { mdns: true };
    expect(availableToolKinds(LOOKUP_TOOL_KINDS, capabilities)).toContain('pcap');
  });

  it('still hides a tool that is explicitly unavailable', () => {
    // The filter itself must keep working — mdns is the case that legitimately
    // uses it, when a build genuinely lacks the feature.
    const capabilities: ToolCapabilityMap = { mdns: false };
    const kinds = availableToolKinds(LOOKUP_TOOL_KINDS, capabilities);
    expect(kinds).not.toContain('mdns');
    expect(kinds).toContain('pcap');
  });

  it('treats an unlisted tool as available', () => {
    expect(availableToolKinds(LOOKUP_TOOL_KINDS, {})).toEqual(LOOKUP_TOOL_KINDS);
  });
});
