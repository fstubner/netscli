import { useEffect, useRef, useState } from 'react';

import { fetchLatestRelease, isNewerVersion } from '../services/releases';
import { checkForUpdate, getInstallSupport, type Update } from '../services/updater';
import type { WorkspaceToast } from '../workspace/types';

export const DISMISSED_RELEASE_KEY = 'netscli-dismissed-release-version';

interface ReleaseNotificationOptions {
  appVersion: string;
  enabled: boolean;
  dismissToast: () => void;
  showUpdateToast: (version: string, url: string, opensUpdateDialog?: boolean) => void;
  toast: WorkspaceToast | null;
}

export interface ReleaseUpdates {
  /** The update this install can apply to itself, once one has been found. */
  pendingUpdate: Update | null;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  /** Never mention this version again. Shared with the link-only notice. */
  skipVersion: (version: string) => void;
}

export function releasePageUrl(version: string): string {
  return `https://github.com/fstubner/netscli/releases/tag/v${version}`;
}

export function useReleaseNotifications({
  appVersion,
  enabled,
  dismissToast,
  showUpdateToast,
  toast,
}: ReleaseNotificationOptions): ReleaseUpdates {
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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

    let cancelled = false;
    const controller = new AbortController();
    const dismissed = () => window.localStorage.getItem(DISMISSED_RELEASE_KEY);

    // A notice with a link to the release page. What every install got
    // before in-app updates, and still what an install that cannot replace
    // itself gets -- or one that can, when latest.json is not reachable.
    async function notifyWithLink() {
      const release = await fetchLatestRelease(controller.signal);
      if (cancelled || dismissed() === release.version) return;
      if (!isNewerVersion(release.version, appVersion)) return;
      callbacks.current.showUpdateToast(release.version, release.url);
    }

    async function run() {
      const support = await getInstallSupport();
      if (cancelled) return;

      if (!support.supported) {
        await notifyWithLink();
        return;
      }

      // One request either way. This one fetches latest.json from the
      // release downloads rather than calling api.github.com, so it does not
      // count against the API's unauthenticated limit.
      let update: Update | null;
      try {
        update = await checkForUpdate();
      } catch (error) {
        // A release published without latest.json, or the minutes between a
        // release going public and its latest.json being attached. Still
        // worth telling the user a release exists.
        console.error('Update check failed, falling back to the release page:', error);
        if (!cancelled) await notifyWithLink();
        return;
      }
      if (cancelled || !update || dismissed() === update.version) return;
      setPendingUpdate(update);
      callbacks.current.showUpdateToast(update.version, releasePageUrl(update.version), true);
    }

    run().catch((error: unknown) => {
      if (cancelled || controller.signal.aborted) return;
      console.error('Release check failed:', error);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [appVersion, enabled]);

  return {
    pendingUpdate,
    dialogOpen,
    openDialog: () => setDialogOpen(true),
    closeDialog: () => setDialogOpen(false),
    skipVersion: (version: string) => {
      window.localStorage.setItem(DISMISSED_RELEASE_KEY, version);
      setDialogOpen(false);
      setPendingUpdate(null);
      callbacks.current.dismissToast();
    },
  };
}
