import { useEffect } from 'react';

import { fetchLatestRelease, isNewerVersion } from '../services/releases';
import type { WorkspaceToast } from '../workspace/types';

interface ReleaseNotificationOptions {
  appVersion: string;
  enabled: boolean;
  dismissToast: () => void;
  showUpdateToast: (version: string, url: string) => void;
  toast: WorkspaceToast | null;
}

export function useReleaseNotifications({
  appVersion,
  enabled,
  dismissToast,
  showUpdateToast,
  toast,
}: ReleaseNotificationOptions) {
  useEffect(() => {
    if (!enabled && toast?.kind === 'update') {
      dismissToast();
    }
  }, [dismissToast, enabled, toast?.kind]);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    void fetchLatestRelease(controller.signal)
      .then((release) => {
        const dismissed = window.localStorage.getItem('netscli-dismissed-release-version');
        if (dismissed === release.version || !isNewerVersion(release.version, appVersion)) return;
        showUpdateToast(release.version, release.url);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error('Release check failed:', error);
      });

    return () => controller.abort();
  }, [appVersion, enabled, showUpdateToast]);
}

