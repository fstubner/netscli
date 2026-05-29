import { isTauri } from './env';

export type AppWindowAction = 'close' | 'minimize' | 'maximize' | 'drag';

export async function appWindowAction(action: AppWindowAction) {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'close') await win.close();
    if (action === 'minimize') await win.minimize();
    if (action === 'maximize') await win.toggleMaximize();
    if (action === 'drag') await win.startDragging();
  } catch {
    return;
  }
}
