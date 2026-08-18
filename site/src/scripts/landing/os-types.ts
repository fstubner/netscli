/** Shared between landing-page.ts and os-tabs.ts. */
export type OperatingSystem = 'windows' | 'macos' | 'linux';

export interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    platform?: string;
    /** Async, and Chromium-only. `architecture` is a high-entropy hint,
     *  so it is not exposed on the object directly. */
    getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
  };
}
