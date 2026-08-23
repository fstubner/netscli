// @vitest-environment jsdom
//
// Defaults on a fresh install.
//
// `Number(null)` is 0 and `Number.isFinite(0)` is true, so reading an unset
// preference through `Number(localStorage.getItem(...))` produced a stored
// zero rather than falling through to the default. Max concurrent probes
// came out as 1 instead of 256 -- serialising every scan, discover and
// sweep -- and traffic precision as 0 instead of 2. Both look like settings
// someone chose, which is why neither was visible as a bug.

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePreferences } from './usePreferences';

describe('preferences on a fresh install', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('runs probes concurrently rather than one at a time', () => {
    const { result } = renderHook(() => usePreferences());

    expect(result.current.maxConcurrentProbes).toBe(256);
  });

  it('shows traffic to two decimal places', () => {
    const { result } = renderHook(() => usePreferences());

    expect(result.current.trafficPrecision).toBe(2);
  });

  it('honours a stored value over the default', () => {
    window.localStorage.setItem('netscli-max-concurrent-probes', '64');
    window.localStorage.setItem('netscli-traffic-precision', '0');

    const { result } = renderHook(() => usePreferences());

    expect(result.current.maxConcurrentProbes).toBe(64);
    // 0 is a legitimate stored precision, and must survive the "not set"
    // check that this fix added.
    expect(result.current.trafficPrecision).toBe(0);
  });

  it('falls back to the default when the stored value is unusable', () => {
    window.localStorage.setItem('netscli-max-concurrent-probes', 'not-a-number');
    window.localStorage.setItem('netscli-traffic-precision', '');

    const { result } = renderHook(() => usePreferences());

    expect(result.current.maxConcurrentProbes).toBe(256);
    expect(result.current.trafficPrecision).toBe(2);
  });
});
