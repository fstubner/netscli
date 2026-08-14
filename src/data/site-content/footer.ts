import type { Analytics, BuiltWithEntry, SocialProof } from './types';

export const builtWith: BuiltWithEntry[] = [
  { name: 'Rust', url: 'https://www.rust-lang.org/' },
  { name: 'ratatui', url: 'https://ratatui.rs/' },
  { name: 'Tauri', url: 'https://tauri.app/' },
  { name: 'hickory', url: 'https://github.com/hickory-dns/hickory-dns' },
  { name: 'sqlx', url: 'https://github.com/launchbadge/sqlx' },
];

export const social: SocialProof = { repo: 'fstubner/netscli' };

export const analytics: Analytics = {
  cloudflareToken: 'c03201f65f6d41aa843c81f259a1ac06',
};
