import type { AddressPreference } from '../../hooks/usePreferences';

/**
 * The one address worth showing for an interface.
 *
 * Honours the user's IPv4/IPv6 preference, falls back to the other family,
 * and only then to whatever the OS happened to list first. That last fallback
 * is the case this exists to avoid being the default: the OS order routinely
 * puts a link-local or a /128 first, so `ips[0]` is the least useful address
 * on the interface as often as not.
 *
 * Shared by the status bar and the interface picker -- both show "the address
 * of this interface" and must not disagree about which one that is.
 */
export function preferredStatusAddress(ips: string[], preference: AddressPreference): string | null {
  const familyPreferred = preference === 'ipv6' ? isIpv6Cidr : isIpv4Cidr;
  const fallbackFamily = preference === 'ipv6' ? isIpv4Cidr : isIpv6Cidr;
  return ips.find(familyPreferred) ?? ips.find(fallbackFamily) ?? ips[0] ?? null;
}

function isIpv4Cidr(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/.test(value);
}

function isIpv6Cidr(value: string): boolean {
  return value.includes(':');
}
