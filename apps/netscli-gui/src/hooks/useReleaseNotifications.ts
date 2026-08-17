import { useEffect, useRef } from 'react';

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
  // The callbacks live in a ref so they cannot re-trigger the effects below.
  //
  // Both are plain functions declared in `useWorkspaceToast`'s body, so each
  // render produces new identities. Listing them as dependencies meant the
  // release check re-ran on *every* render: it aborted the in-flight request
  // and issued another one. During a scan that is roughly one request to
  // api.github.com per progress event — per probed port — and the
  // unauthenticated limit is 60 an hour, so the app rate-limited itself out
  // of update checks within seconds of normal use. Even idle it refired every
  // 30s, because the interface poll sets state with freshly deserialized
  // values each time.
  //
  // Same shape as the handler ref in useKeyboardShortcuts: assign in an
  // effect with no dependency array, so it runs after every render and only
  // ever writes a ref.
  const callbacks = useRef({ dismissToast, showUpdateToast });
  useEffect(() => {
    callbacks.current = { dismissToast, showUpdateToast };
  });

  useEffect(() => {
    if (!enabled && toast?.kind === 'update') {
      callbacks.current.dismissToast();
    }
  }, [enabled, toast?.kind]);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    void fetchLatestRelease(controller.signal)
      .then((release) => {
        const dismissed = window.localStorage.getItem('netscli-dismissed-release-version');
        if (dismissed === release.version || !isNewerVersion(release.version, appVersion)) return;
        callbacks.current.showUpdateToast(release.version, release.url);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error('Release check failed:', error);
      });

    return () => controller.abort();
  }, [appVersion, enabled]);
}
