import { useEffect, useRef, useState, type MouseEvent } from 'react';

import './App.css';

import { handleAppFrameMouseDown } from './components/shell/appFrameDrag';
import { clearArpThenRun } from './workspace/clearArpThenRun';
import { AppDialogs } from './components/shell/AppDialogs';
import { AppFrame } from './components/shell/AppFrame';
import { AppTooltip } from './components/shell/AppTooltip';
import { MenuBar } from './components/shell/MenuBar';
import { StatusBar } from './components/shell/StatusBar';
import { TabStrip } from './components/shell/TabStrip';
import { Toolbar } from './components/shell/Toolbar';
import { WorkspaceView } from './components/shell/WorkspaceView';
import { ToastHost } from './components/shell/ToastHost';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePopoverDismissal } from './hooks/usePopoverDismissal';
import { usePreferences } from './hooks/usePreferences';
import { useReleaseNotifications } from './hooks/useReleaseNotifications';
import { useTauriRuntimeState } from './hooks/useTauriRuntimeState';
import { appWindowAction, type AppWindowAction } from './services/appWindow';
import type { ResultCellContext } from './tools/types';
import { packetCaptureUnavailableMessage } from './workspace/packetCapture';
import { guardForOperation, type OperationGuard } from './workspace/operationGuards';
import { useWorkspace } from './workspace/useWorkspace';

const APP_VERSION = __APP_VERSION__;

function App() {
  const preferences = usePreferences();
  // Only the values App itself reads. The setters exist to build dialog
  // props, and the dialogs take `preferences` whole now.
  const {
    addressPreference,
    commandBarVisible,
    darkMode,
    interactionToasts,
    maxConcurrentProbes,
    operationToasts,
    persistentHistory,
    releaseNotifications,
    trafficDisplayUnit,
    trafficIndicators,
    trafficPrecision,
  } = preferences;
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [contentContextMenu, setContentContextMenu] = useState<{
    cell?: ResultCellContext;
    x: number;
    y: number;
  } | null>(null);
  const {
    chooseSaveFolder,
    clearSaveFolder,
    fileSavePreferences,
    pcapCapability,
    toolCapabilities,
    toggleFileSaveAskEachTime,
  } = useTauriRuntimeState();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pendingRun, setPendingRun] = useState<{ tabId: string; guard: OperationGuard } | null>(null);
  const [pendingHistoryDisable, setPendingHistoryDisable] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const workspace = useWorkspace({
    interactionToasts,
    maxConcurrentProbes,
    operationToasts,
    persistentHistory,
  });
  const activeTab = workspace.activeTab;

  useReleaseNotifications({
    appVersion: APP_VERSION,
    dismissToast: workspace.dismissToast,
    enabled: releaseNotifications,
    showUpdateToast: workspace.showUpdateToast,
    toast: workspace.toast,
  });

  usePopoverDismissal({ contentContextMenu, openMenu, setContentContextMenu, setOpenMenu });

  function requestRun(tabId: string) {
    const tab = workspace.tabs.find((item) => item.id === tabId);
    if (tab?.kind === 'pcap' && !pcapCapability.available) {
      workspace.showInteractionToast(packetCaptureUnavailableMessage(pcapCapability.message));
      return;
    }
    const guard = guardForOperation(tab);
    if (guard) {
      setPendingRun({ tabId, guard });
      return;
    }
    void workspace.runTab(tabId);
  }

  useEffect(() => {
    if (!activeTab || !workspace.needsAutoRun(activeTab.id)) return;
    if (activeTab.busy || activeTab.result) return;
    workspace.clearAutoRun(activeTab.id);
    requestRun(activeTab.id);
    // `requestRun` and `workspace` are rebuilt every render, so depending on
    // them would refire this on every render and re-trigger the auto-run.
    // The three fields listed are the whole trigger: a tab became active,
    // finished, or produced a result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id, activeTab?.busy, activeTab?.result]);

  useKeyboardShortcuts({
    focusResultFilter: () => {
      filterInputRef.current?.focus({ preventScroll: true });
      filterInputRef.current?.select();
    },
    openMenu,
    requestRun,
    setOpenMenu,
    setSettingsOpen,
    settingsOpen,
    setWorkspaceSearchOpen,
    workspace,
    workspaceSearchOpen,
  });

  function runActive() {
    if (activeTab) requestRun(activeTab.id);
  }

  function cancelActive() {
    if (activeTab) void workspace.cancelTab(activeTab.id);
  }

  function windowAction(action: AppWindowAction) {
    void appWindowAction(action);
  }

  function openContentContextMenu(event: MouseEvent<HTMLElement>, cell?: ResultCellContext) {
    if (!activeTab) return;
    event.preventDefault();
    setOpenMenu(null);
    const menuWidth = 240;
    const menuHeight = 190;
    setContentContextMenu({
      cell,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
  }

  // Two different questions. The menu asks "can packet capture run at all",
  // which is true or false regardless of which tab is open; Run asks "can
  // THIS tab run", which is only about pcap when a pcap tab is active.
  // Conflating them greyed the menu entry only once you had already opened
  // the thing the entry is for.
  const packetCaptureUnavailable = !pcapCapability.available
    ? packetCaptureUnavailableMessage(pcapCapability.message)
    : null;
  const pcapUnavailableReason = activeTab?.kind === 'pcap' ? packetCaptureUnavailable : null;

  return (
    <div className={`container ${darkMode ? 'theme-dark' : 'theme-light'}`} data-testid="app-shell">
      <AppFrame onDragStart={handleAppFrameMouseDown} onWindowAction={windowAction}>
        <MenuBar
          activeTab={activeTab}
          history={workspace.history}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          tabCount={workspace.tabs.length}
          toolCapabilities={toolCapabilities}
          toolDisabledReasons={packetCaptureUnavailable ? { pcap: packetCaptureUnavailable } : undefined}
          onAddTab={workspace.addTab}
          onAbout={() => setAboutOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onCancelActive={cancelActive}
          onClearCurrentResults={workspace.clearCurrentResults}
          onClearHistory={workspace.clearHistory}
          onCloseAllTabs={workspace.closeAllTabs}
          onCloseCurrentTab={() => {
            if (activeTab) workspace.closeTab(activeTab.id);
          }}
          onCloseOtherTabs={workspace.closeOtherTabs}
          onCloseWindow={() => windowAction('close')}
          onCopyCommand={() => void workspace.copyCommand()}
          onCopySelectedDetails={() => void workspace.copySelectedDetails()}
          onCopySelectedRaw={() => void workspace.copySelectedRaw()}
          onExport={workspace.exportCurrent}
          onExportSelectedJson={workspace.exportSelectedJson}
          onExportSelectedCsv={workspace.exportSelectedCsv}
          onOpenResultBundle={() => void workspace.openResultBundle()}
          onSaveResultBundle={() => void workspace.saveResultBundle()}
          onOpenHistoryEntry={workspace.openHistoryEntry}
          onRunActive={runActive}
          runDisabledReason={pcapUnavailableReason ?? undefined}
        />
      </AppFrame>

      <Toolbar
        activeTab={activeTab}
        filterInputRef={filterInputRef}
        filterText={workspace.filterText}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        setFilterText={workspace.setFilterText}
        onCancelActive={cancelActive}
        onExportCsv={() => workspace.exportCurrent('csv')}
        onExportJson={() => workspace.exportCurrent('json')}
        onRunActive={runActive}
        onRunActiveWithArpClear={() =>
          void clearArpThenRun(activeTab?.id, requestRun, (id, error) =>
            workspace.patchTab(id, { error }),
          )
        }
        runDisabledReason={pcapUnavailableReason ?? undefined}
      />

      <TabStrip
        activeTabId={workspace.activeTabId}
        openMenu={openMenu}
        tabs={workspace.tabs}
        toolCapabilities={toolCapabilities}
        toolDisabledReasons={packetCaptureUnavailable ? { pcap: packetCaptureUnavailable } : undefined}
        onAddScanTab={() => workspace.addTab('scan')}
        onAddToolTab={workspace.addTab}
        onCloseTab={workspace.closeTab}
        onCloseAllTabs={workspace.closeAllTabs}
        onCloseOtherTabs={workspace.closeOtherTabs}
        onCloseTabsBeside={workspace.closeTabsBeside}
        onMoveTab={workspace.moveTab}
        onSelectTab={workspace.setActiveTabId}
        setOpenMenu={setOpenMenu}
      />

      <WorkspaceView
        commandBarVisible={commandBarVisible}
        pcapCapability={pcapCapability}
        toolCapabilities={toolCapabilities}
        toolDisabledReasons={packetCaptureUnavailable ? { pcap: packetCaptureUnavailable } : undefined}
        workspace={workspace}
        onContentContextMenu={openContentContextMenu}
        onRequestRun={requestRun}
      />

      <StatusBar
        activeTab={activeTab}
        addressPreference={addressPreference}
        animateTrafficArrows={trafficIndicators}
        interfaceInfo={workspace.statusInterfaceInfo}
        networkStats={workspace.networkStats}
        rowCount={workspace.rows.length}
        selectedCount={workspace.selectedRows.length}
        trafficDisplayUnit={trafficDisplayUnit}
        trafficPrecision={trafficPrecision}
      />

      <ToastHost
        dismissToast={workspace.dismissToast}
        setActiveTabId={workspace.setActiveTabId}
        toast={workspace.toast}
      />
      <AppDialogs
        aboutOpen={aboutOpen}
        preferences={preferences}
        activeTab={activeTab}
        appVersion={APP_VERSION}
        chooseSaveFolder={chooseSaveFolder}
        clearSaveFolder={clearSaveFolder}
        contentContextMenu={contentContextMenu}
        defaultInterface={workspace.defaultInterface}
        fileSavePreferences={fileSavePreferences}
        interfaces={workspace.interfaces}
        onCloseAbout={() => setAboutOpen(false)}
        onCloseContentContextMenu={() => setContentContextMenu(null)}
        onCloseSettings={() => setSettingsOpen(false)}
        onCloseWorkspaceSearch={() => setWorkspaceSearchOpen(false)}
        onConfirmHistoryDisable={() => {
          setPendingHistoryDisable(false);
          preferences.setPersistentHistory(false);
        }}
        onConfirmPendingRun={(tabId) => void workspace.runTab(tabId)}
        onToggleFileSaveAskEachTime={() => void toggleFileSaveAskEachTime()}
        pendingHistoryDisable={pendingHistoryDisable}
        pendingRun={pendingRun}
        setPendingHistoryDisable={setPendingHistoryDisable}
        setPendingRun={setPendingRun}
        settingsOpen={settingsOpen}
        workspace={workspace}
        workspaceSearchOpen={workspaceSearchOpen}
      />
      <AppTooltip />
    </div>
  );
}


export default App;
