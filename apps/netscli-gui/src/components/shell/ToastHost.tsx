import { openAllowedExternalUrl } from '../../services/externalLinks';
import type { WorkspaceToast } from '../../workspace/types';

interface ToastHostProps {
  dismissToast: () => void;
  setActiveTabId: (tabId: string) => void;
  toast: WorkspaceToast | null;
}

export function ToastHost({ dismissToast, setActiveTabId, toast }: ToastHostProps) {
  if (!toast) return null;

  const actionLabel = toast.actionUrl ? 'View release' : toast.tabId ? 'Open tab' : null;

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
