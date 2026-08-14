import { openAllowedExternalUrl } from '../../services/externalLinks';
import type { WorkspaceToast } from '../../workspace/types';

interface ToastHostProps {
  dismissToast: () => void;
  setActiveTabId: (tabId: string) => void;
  toast: WorkspaceToast | null;
}

export function ToastHost({ dismissToast, setActiveTabId, toast }: ToastHostProps) {
  const actionLabel = toast?.actionUrl ? 'View release' : toast?.tabId ? 'Open tab' : null;

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
        setActiveTabId={setActiveTabId}
        toast={toast}
      />}
    </div>
  );
}

function ToastButton({
  actionLabel,
  dismissToast,
  setActiveTabId,
  toast,
}: {
  actionLabel: string | null;
  dismissToast: () => void;
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
        if (toast.actionUrl) {
          void openAllowedExternalUrl(toast.actionUrl);
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
