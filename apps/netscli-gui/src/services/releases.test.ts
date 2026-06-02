import { describe, expect, it } from 'vitest';

import { compareVersions, isNewerVersion, normalizeVersion } from './releases';

describe('release version helpers', () => {
  it('normalizes tags before comparison', () => {
    expect(normalizeVersion('v0.2.7')).toBe('0.2.7');
    expect(normalizeVersion('0.3.0-beta.1')).toBe('0.3.0');
  });

  it('compares semver-like release tags', () => {
    expect(compareVersions('0.2.7', '0.2.6')).toBeGreaterThan(0);
    expect(compareVersions('v0.2.6', '0.2.6')).toBe(0);
    expect(compareVersions('0.2.5', '0.2.6')).toBeLessThan(0);
    expect(isNewerVersion('v0.3.0', '0.2.9')).toBe(true);
  });
});
