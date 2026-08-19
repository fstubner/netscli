import { describe, expect, it } from 'vitest';
import { validateFieldValue, validateHost, validatePorts, validateSubnet } from './fieldValidation';
import { validateTab } from '../workspace/toolExecution';
import type { WorkspaceTab } from './types';

/** The cases that used to reach the backend. Each of these passed the old
 *  presence-only check, because each is a non-empty string. */
describe('free-text fields are checked for shape, not just presence', () => {
  it('rejects a ports value that is not ports', () => {
    expect(validatePorts('hello')).toMatch(/not a port/);
  });

  it('rejects port 0 and 65536, which the core rejects too', () => {
    expect(validatePorts('0')).toMatch(/not a port/);
    expect(validatePorts('65536')).toMatch(/not a port/);
  });

  it('rejects a range that ends before it starts', () => {
    expect(validatePorts('443-80')).toMatch(/starts above/);
  });

  it('accepts the forms the core parser accepts', () => {
    expect(validatePorts('22,80,443')).toBeNull();
    expect(validatePorts('1-1024')).toBeNull();
    expect(validatePorts('22, 80 , 443-445')).toBeNull();
    // parse_ports tolerates empty segments, so this layer must too.
    expect(validatePorts('22,,80')).toBeNull();
    expect(validatePorts('')).toBeNull();
  });

  it('rejects a subnet wider than the engines will run', () => {
    expect(validateSubnet('10.0.0.0/8')).toMatch(/safety limit/);
    expect(validateSubnet('192.168.1.0/24')).toBeNull();
  });

  it('rejects a subnet with no prefix', () => {
    expect(validateSubnet('192.168.1.0')).toMatch(/needs a \/prefix/);
  });

  it('rejects a host with spaces but accepts hostnames and IPs', () => {
    expect(validateHost('two words')).toMatch(/spaces/);
    expect(validateHost('netscli.com')).toBeNull();
    expect(validateHost('192.168.1.1')).toBeNull();
    expect(validateHost('::1')).toBeNull();
    expect(validateHost('my-host.local.')).toBeNull();
  });

  it('leaves BPF filters alone', () => {
    expect(validateFieldValue('filter', 'tcp port 443 and not host 10.0.0.1')).toBeNull();
  });
});

describe('validateTab', () => {
  const tab = (kind: WorkspaceTab['kind'], form: Record<string, string>) =>
    ({ kind, form }) as unknown as WorkspaceTab;

  it('blocks a scan whose ports are not ports', () => {
    expect(validateTab(tab('scan', { host: '127.0.0.1', ports: 'hello' }))).toMatch(/not a port/);
  });

  it('blocks a discover over a subnet the engine would refuse', () => {
    expect(validateTab(tab('discover', { subnet: '0.0.0.0/0' }))).toMatch(/safety limit/);
  });

  it('still reports a missing required field first', () => {
    expect(validateTab(tab('scan', { host: '', ports: 'hello' }))).toMatch(/required/);
  });

  it('passes a well-formed run', () => {
    expect(validateTab(tab('scan', { host: '127.0.0.1', ports: '22,80,443' }))).toBeNull();
  });
});
