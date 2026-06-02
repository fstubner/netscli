import { useEffect, useRef, useState } from 'react';

import { isAllowedExternalUrl } from '../services/externalLinks';
import { generateId } from '../tools/registry';
import type { WorkspaceOptions, WorkspaceToast } from './types';

export function useWorkspaceToast(options: WorkspaceOptions) {
  const [toast, setToast] = useState<WorkspaceToast | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!toast || toast.persistent) return;
    const timeout = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function showToast(toast: Omit<WorkspaceToast, 'id'>) {
    const settings = optionsRef.current;
    if (toast.kind === 'interaction' && !settings.interactionToasts) return;
    if (toast.kind === 'operation' && !settings.operationToasts) return;
    setToast({ ...toast, id: generateId('toast') });
  }

  function dismissToast() {
    setToast(null);
  }

  function showUpdateToast(version: string, url: string) {
    if (!isAllowedExternalUrl(url)) return;

    setToast({
      id: generateId('toast'),
      message: `Update available: v${version}`,
      kind: 'update',
      persistent: true,
      actionUrl: url,
      releaseVersion: version,
    });
  }

  return { dismissToast, showToast, showUpdateToast, toast };
}
