/**
 * Shape checks for the free-text tool fields, before a run is dispatched.
 *
 * The numeric fields have been bounded for a while -- `min`/`max` on the
 * field definition, clamped by NumberField. The free-text ones were gated
 * only on presence, so `ports: "hello"` was accepted by the form, sent to the
 * backend, and came back as an error after a round trip. `subnet` was not
 * even marked required, so an empty discover ran against whatever the backend
 * defaulted to.
 *
 * These deliberately mirror what the core parsers accept rather than being
 * stricter. Rejecting something the CLI would have run is worse than letting
 * an odd-but-valid value through: the backend still validates, and this layer
 * exists to give a fast answer, not to be the authority.
 *
 * `filter` is not checked. It is a BPF expression, the grammar is large, and
 * a partial reimplementation here would reject valid filters.
 */

/** 1-65535, matching the core parser's `u16` with zero rejected. */
function isPort(token: string): boolean {
  if (!/^\d{1,5}$/.test(token)) return false;
  const value = Number(token);
  return value >= 1 && value <= 65535;
}

/** Comma-separated ports and `start-end` ranges, the form `parse_ports`
 *  accepts. Empty segments are tolerated there, so they are tolerated here. */
export function validatePorts(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  for (const part of value.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const range = token.split('-');
    if (range.length > 2) return `"${token}" is not a port or range`;
    if (!range.every((end) => isPort(end.trim()))) {
      return `"${token}" is not a port or range (1-65535)`;
    }
    if (range.length === 2 && Number(range[0].trim()) > Number(range[1].trim())) {
      return `"${token}" starts above where it ends`;
    }
  }
  return null;
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Deliberately loose: anything with a colon and hex digits is taken as IPv6
 *  rather than reimplementing the address grammar and its `::` elision. */
function isIpv6(value: string): boolean {
  return value.includes(':') && /^[0-9a-fA-F:.]+$/.test(value);
}

export function validateIp(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return isIpv4(value) || isIpv6(value) ? null : `"${value}" is not an IP address`;
}

/** A hostname or an IP. Hostnames are checked for shape only -- labels of
 *  letters, digits and hyphens -- because the resolver is the authority on
 *  whether one exists. */
export function validateHost(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (isIpv4(value) || isIpv6(value)) return null;
  if (/\s/.test(value)) return 'Host cannot contain spaces';
  if (value.length > 253) return 'Host is too long';
  const labels = value.replace(/\.$/, '').split('.');
  const ok = labels.every((label) => /^[a-zA-Z0-9_](?:[a-zA-Z0-9_-]*[a-zA-Z0-9_])?$/.test(label) && label.length <= 63);
  return ok ? null : `"${value}" is not a hostname or IP address`;
}

/** IPv4 CIDR. The engines cap the prefix at /16; anything shorter is a
 *  refusal from the backend, so say so here instead of after the round trip. */
export function validateSubnet(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const [address, prefix, ...rest] = value.split('/');
  if (rest.length > 0 || prefix === undefined) return `"${value}" needs a /prefix, e.g. 192.168.1.0/24`;
  if (!isIpv4(address)) return `"${address}" is not an IPv4 address`;
  if (!/^\d{1,2}$/.test(prefix)) return `"/${prefix}" is not a prefix length`;
  const bits = Number(prefix);
  if (bits > 32) return 'Prefix length cannot exceed /32';
  if (bits < 16) return 'Subnet is larger than /16, which the safety limit refuses';
  return null;
}

const BY_KEY: Record<string, (value: string) => string | null> = {
  host: validateHost,
  ip: validateIp,
  ports: validatePorts,
  subnet: validateSubnet,
};

/** Keyed on the field name rather than declared per field, because these
 *  names mean the same thing in every tool that uses them. */
export function validateFieldValue(key: string, value: string): string | null {
  return BY_KEY[key]?.(value) ?? null;
}
