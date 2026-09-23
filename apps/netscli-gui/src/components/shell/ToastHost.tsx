import { releasePageUrl, type ReleaseUpdates } from '../../hooks/useReleaseNotifications';
import { openAllowedExternalUrl } from '../../services/externalLinks';
import { installUpdate } from '../../services/updater';
import type { WorkspaceToast } from '../../workspace/types';
import { UpdateDialog } from './UpdateDialog';

interface ToastHostProps {
  appVersion: string;
  dismissToast: () => void;
  setActiveTabId: (tabId: string) => void;
  toast: WorkspaceToast | null;
  /** The update dialog opens from the update toast, so it lives here. */
  updates: ReleaseUpdates;
}

export function ToastHost({ appVersion, dismissToast, setActiveTabId, toast, updates }: ToastHostProps) {
  const actionLabel = toast?.opensUpdateDialog
    ? 'View update'
    : toast?.actionUrl
      ? 'View release'
      : toast?.tabId
        ? 'Open tab'
        : null;
  const update = updates.pendingUpdate;

  // The live region is rendered unconditionally, even with no toast (B-21).
  //
  // Screen readers only announce changes *within* a region that already
  // existed; inserting an element that itself carries `aria-live` is
  // unreliable. Previously this component returned null with no toast, so
  // operation-complete and operation-*failed* notices were silent.
  //
  // `.toast` is `position: absolute`, and a static wrapper does not create a
  // containing block, so this does not move it.
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {toast && <ToastButton
        actionLabel={actionLabel}
        dismissToast={dismissToast}
        openUpdateDialog={updates.openDialog}
        setActiveTabId={setActiveTabId}
        toast={toast}
      />}
      {updates.dialogOpen && update && (
        <UpdateDialog
          currentVersion={appVersion}
          notes={update.body}
          version={update.version}
          onInstall={(onProgress) => installUpdate(update, onProgress)}
          onLater={updates.closeDialog}
          onOpenReleasePage={() => {
            openAllowedExternalUrl(releasePageUrl(update.version)).catch((error: unknown) =>
              console.error('Opening the link failed', error),
            );
          }}
          onSkip={() => updates.skipVersion(update.version)}
        />
      )}
    </div>
  );
}

function ToastButton({
  actionLabel,
  dismissToast,
  openUpdateDialog,
  setActiveTabId,
  toast,
}: {
  actionLabel: string | null;
  dismissToast: () => void;
  openUpdateDialog: () => void;
  setActiveTabId: (tabId: string) => void;
  toast: WorkspaceToast;
}) {
  return (
    <button
      className={[
        'toast',
        toast.tabId || toast.actionUrl ? 'actionable' : '',
        toast.persistent ? 'persistent' : '',
      ].join(' ')}
      aria-label={actionLabel ? `${toast.message}. ${actionLabel}` : toast.message}
      data-testid="toast"
      key={toast.id}
      type="button"
      onClick={() => {
        if (toast.opensUpdateDialog) {
          // Not marked dismissed: "Later" in the dialog should bring the
          // notice back on the next launch, and "Skip" records it itself.
          openUpdateDialog();
        } else if (toast.actionUrl) {
          openAllowedExternalUrl(toast.actionUrl).catch((error: unknown) =>
            console.error('Opening the link failed', error),
          );
          if (toast.releaseVersion) {
            window.localStorage.setItem('netscli-dismissed-release-version', toast.releaseVersion);
          }
        } else if (toast.tabId) {
          setActiveTabId(toast.tabId);
        }
        dismissToast();
      }}
    >
      <span className="toast-message">{toast.message}</span>
      {actionLabel && (
        <span className="toast-action" aria-hidden="true">
          {actionLabel}
        </span>
      )}
    </button>
  );
}
