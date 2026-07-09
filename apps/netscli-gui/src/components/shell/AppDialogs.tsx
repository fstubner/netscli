import { AboutDialog } from './AboutDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ContentContextMenu } from './ContentContextMenu';
import { SettingsDialog } from './SettingsDialog';
import { WorkspaceSearchDialog } from './WorkspaceSearchDialog';
import type { ResultCellContext } from '../../tools/types';
import type { OperationGuard } from '../../workspace/operationGuards';
import type { FileSavePreferences } from '../../types/netscli';
import type { WorkspaceModel } from '../../workspace/types';
import type {
  AddressPreference,
  TrafficDisplayUnit,
  TrafficPrecision,
} from '../../hooks/usePreferences';

type ContentContextMenuState = {
  cell?: ResultCellContext;
  x: number;
  y: number;
} | null;

type AppDialogsProps = {
  aboutOpen: boolean;
  activeTab: WorkspaceModel['activeTab'];
  addressPreference: AddressPreference;
  animateTrafficArrows: boolean;
  appVersion: string;
  chooseSaveFolder: () => Promise<void>;
  clearSaveFolder: () => Promise<void>;
  commandBarVisible: boolean;
  contentContextMenu: ContentContextMenuState;
  darkMode: boolean;
  defaultInterface: WorkspaceModel['defaultInterface'];
  fileSavePreferences: FileSavePreferences;
  interactionToasts: boolean;
  interfaces: WorkspaceModel['interfaces'];
  maxConcurrentProbes: number;
  onCloseAbout: () => void;
  onCloseContentContextMenu: () => void;
  onCloseSettings: () => void;
  onCloseWorkspaceSearch: () => void;
  onConfirmHistoryDisable: () => void;
  onConfirmPendingRun: (tabId: string) => void;
  onSetAddressPreference: (value: AddressPreference) => void;
  onSetDarkMode: (value: boolean) => void;
  onSetMaxConcurrentProbes: (value: number) => void;
  onSetTrafficDisplayUnit: (value: TrafficDisplayUnit) => void;
  onSetTrafficPrecision: (value: TrafficPrecision) => void;
  onToggleCommandBar: () => void;
  onToggleFileSaveAskEachTime: () => void;
  onToggleInteractionToasts: () => void;
  onToggleOperationToasts: () => void;
  onToggleReleaseNotifications: () => void;
  onToggleTrafficArrowAnimation: () => void;
  operationToasts: boolean;
  pendingHistoryDisable: boolean;
  pendingRun: { tabId: string; guard: OperationGuard } | null;
  persistentHistory: boolean;
  releaseNotifications: boolean;
  setPendingHistoryDisable: (value: boolean) => void;
  setPendingRun: (value: { tabId: string; guard: OperationGuard } | null) => void;
  setPersistentHistory: (value: boolean) => void;
  settingsOpen: boolean;
  trafficDisplayUnit: TrafficDisplayUnit;
  trafficPrecision: TrafficPrecision;
  workspace: WorkspaceModel;
  workspaceSearchOpen: boolean;
};

export function AppDialogs({
  aboutOpen,
  activeTab,
  addressPreference,
  animateTrafficArrows,
  appVersion,
  chooseSaveFolder,
  clearSaveFolder,
  commandBarVisible,
  contentContextMenu,
  darkMode,
  defaultInterface,
  fileSavePreferences,
  interactionToasts,
  interfaces,
  maxConcurrentProbes,
  onCloseAbout,
  onCloseContentContextMenu,
  onCloseSettings,
  onCloseWorkspaceSearch,
  onConfirmHistoryDisable,
  onConfirmPendingRun,
  onSetAddressPreference,
  onSetDarkMode,
  onSetMaxConcurrentProbes,
  onSetTrafficDisplayUnit,
  onSetTrafficPrecision,
  onToggleCommandBar,
  onToggleFileSaveAskEachTime,
  onToggleInteractionToasts,
  onToggleOperationToasts,
  onToggleReleaseNotifications,
  onToggleTrafficArrowAnimation,
  operationToasts,
  pendingHistoryDisable,
  pendingRun,
  persistentHistory,
  releaseNotifications,
  setPendingHistoryDisable,
  setPendingRun,
  setPersistentHistory,
  settingsOpen,
  trafficDisplayUnit,
  trafficPrecision,
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
          animateTrafficArrows={animateTrafficArrows}
          addressPreference={addressPreference}
          commandBarVisible={commandBarVisible}
          darkMode={darkMode}
          defaultInterface={defaultInterface}
          interactionToasts={interactionToasts}
          interfaces={interfaces}
          maxConcurrentProbes={maxConcurrentProbes}
          operationToasts={operationToasts}
          persistentHistory={persistentHistory}
          releaseNotifications={releaseNotifications}
          trafficDisplayUnit={trafficDisplayUnit}
          fileSavePreferences={fileSavePreferences}
          trafficPrecision={trafficPrecision}
          trafficInterfaceName={workspace.trafficInterfaceName}
          onClose={onCloseSettings}
          onChooseSaveFolder={() => void chooseSaveFolder()}
          onClearSaveFolder={() => void clearSaveFolder()}
          onSelectTrafficInterface={workspace.setTrafficInterfaceName}
          onSetAddressPreference={onSetAddressPreference}
          onSetDarkMode={onSetDarkMode}
          onSetMaxConcurrentProbes={onSetMaxConcurrentProbes}
          onSetTrafficDisplayUnit={onSetTrafficDisplayUnit}
          onSetTrafficPrecision={onSetTrafficPrecision}
          onToggleFileSaveAskEachTime={onToggleFileSaveAskEachTime}
          onToggleInteractionToasts={onToggleInteractionToasts}
          onToggleOperationToasts={onToggleOperationToasts}
          onTogglePersistentHistory={() => {
            if (persistentHistory) {
              setPendingHistoryDisable(true);
              return;
            }
            setPersistentHistory(true);
          }}
          onToggleReleaseNotifications={onToggleReleaseNotifications}
          onToggleCommandBar={onToggleCommandBar}
          onToggleTrafficArrowAnimation={onToggleTrafficArrowAnimation}
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
            window.setTimeout(() => workspace.selectRow(rowIndex), 0);
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
