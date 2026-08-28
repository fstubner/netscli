import { AboutDialog } from './AboutDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ContentContextMenu } from './ContentContextMenu';
import { SettingsDialog } from './SettingsDialog';
import { WorkspaceSearchDialog } from './WorkspaceSearchDialog';
import type { ResultCellContext } from '../../tools/types';
import type { OperationGuard } from '../../workspace/operationGuards';
import type { FileSavePreferences } from '../../types/netscli';
import type { WorkspaceModel } from '../../workspace/types';
import type { Preferences } from '../../hooks/usePreferences';

type ContentContextMenuState = {
  cell?: ResultCellContext;
  x: number;
  y: number;
} | null;

type AppDialogsProps = {
  /** The whole preferences hook value, passed down rather than unpacked:
   *  every member below the App is either read or set by the settings
   *  dialog, and naming them one at a time here and again in the call was
   *  60-odd lines of plumbing across three files. */
  preferences: Preferences;
  aboutOpen: boolean;
  activeTab: WorkspaceModel['activeTab'];
  appVersion: string;
  chooseSaveFolder: () => Promise<void>;
  clearSaveFolder: () => Promise<void>;
  contentContextMenu: ContentContextMenuState;
  defaultInterface: WorkspaceModel['defaultInterface'];
  fileSavePreferences: FileSavePreferences;
  interfaces: WorkspaceModel['interfaces'];
  onCloseAbout: () => void;
  onCloseContentContextMenu: () => void;
  onCloseSettings: () => void;
  onCloseWorkspaceSearch: () => void;
  onConfirmHistoryDisable: () => void;
  onConfirmPendingRun: (tabId: string) => void;
  onToggleFileSaveAskEachTime: () => void;
  pendingHistoryDisable: boolean;
  pendingRun: { tabId: string; guard: OperationGuard } | null;
  setPendingHistoryDisable: (value: boolean) => void;
  setPendingRun: (value: { tabId: string; guard: OperationGuard } | null) => void;
  settingsOpen: boolean;
  workspace: WorkspaceModel;
  workspaceSearchOpen: boolean;
};

export function AppDialogs({
  preferences,
  aboutOpen,
  activeTab,
  appVersion,
  chooseSaveFolder,
  clearSaveFolder,
  contentContextMenu,
  defaultInterface,
  fileSavePreferences,
  interfaces,
  onCloseAbout,
  onCloseContentContextMenu,
  onCloseSettings,
  onCloseWorkspaceSearch,
  onConfirmHistoryDisable,
  onConfirmPendingRun,
  onToggleFileSaveAskEachTime,
  pendingHistoryDisable,
  pendingRun,
  setPendingHistoryDisable,
  setPendingRun,
  settingsOpen,
  workspace,
  workspaceSearchOpen,
}: AppDialogsProps) {
  return (
    <>
      {contentContextMenu && (
        <ContentContextMenu
          canClear={Boolean(activeTab && (activeTab.result || activeTab.error))}
          canUseSelection={Boolean(activeTab?.result)}
          captureFilePath={activeTab?.result?.kind === 'pcap' ? activeTab.result.data.file_path : undefined}
          cell={contentContextMenu.cell}
          x={contentContextMenu.x}
          y={contentContextMenu.y}
          onClearResults={workspace.clearCurrentResults}
          onClose={onCloseContentContextMenu}
          onCopyCell={(cell) => void workspace.copyCellValue(cell.label, cell.value)}
          onCopyDetails={() => void workspace.copySelectedDetails()}
          onCopyRaw={() => void workspace.copySelectedRaw()}
          onExportCsv={workspace.exportSelectedCsv}
          onExportJson={workspace.exportSelectedJson}
          onInspectHost={(host) => workspace.openHostTool('inspect', host)}
          onOpenCaptureFile={(path) => void workspace.openCaptureFile(path)}
          onRevealCaptureFile={(path) => void workspace.revealCaptureFile(path)}
          onScanHost={(host) => workspace.openHostTool('scan', host)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          preferences={preferences}
          defaultInterface={defaultInterface}
          interfaces={interfaces}
          fileSavePreferences={fileSavePreferences}
          trafficInterfaceName={workspace.trafficInterfaceName}
          onClose={onCloseSettings}
          onChooseSaveFolder={() => void chooseSaveFolder()}
          onClearSaveFolder={() => void clearSaveFolder()}
          onSelectTrafficInterface={workspace.setTrafficInterfaceName}
          onToggleFileSaveAskEachTime={onToggleFileSaveAskEachTime}
          onTogglePersistentHistory={() => {
            if (preferences.persistentHistory) {
              setPendingHistoryDisable(true);
              return;
            }
            preferences.setPersistentHistory(true);
          }}
        />
      )}
      {workspaceSearchOpen && (
        <WorkspaceSearchDialog
          history={workspace.history}
          tabs={workspace.tabs}
          onClose={onCloseWorkspaceSearch}
          onOpenHistoryEntry={workspace.openHistoryEntry}
          onSelectTab={workspace.setActiveTabId}
          onSelectRow={(tabId, rowIndex) => {
            workspace.setActiveTabId(tabId);
            workspace.selectRowInTab(tabId, rowIndex);
          }}
        />
      )}
      {aboutOpen && <AboutDialog appVersion={appVersion} onClose={onCloseAbout} />}
      {pendingHistoryDisable && (
        <ConfirmDialog
          confirmLabel="Disable history"
          message="Turning off Save History clears stored runs from this device immediately."
          title="Disable Save History?"
          onCancel={() => setPendingHistoryDisable(false)}
          onConfirm={onConfirmHistoryDisable}
        />
      )}
      {pendingRun && (
        <ConfirmDialog
          confirmLabel={pendingRun.guard.confirmLabel}
          message={pendingRun.guard.message}
          title={pendingRun.guard.title}
          onCancel={() => setPendingRun(null)}
          onConfirm={() => {
            const tabId = pendingRun.tabId;
            setPendingRun(null);
            onConfirmPendingRun(tabId);
          }}
        />
      )}
    </>
  );
}
