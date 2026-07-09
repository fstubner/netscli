import type { ChangelogRelease } from './types';

declare global {
  interface Window {
    /** Server-computed changelog data, bridged from a define:vars script
     *  (which isn't run through Vite's import resolution) to the plain
     *  module script that renders it. See pages/changelog.astro. */
    __netscliChangelogData: {
      repo: string;
      fallbackReleases: ChangelogRelease[];
      releaseSummaries: Record<string, string>;
    };
  }
}

export {};
