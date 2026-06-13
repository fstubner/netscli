import { useRef, useState, type MouseEvent } from 'react';

import './App.css';

import { AboutDialog } from './components/shell/AboutDialog';
import { AppFrame } from './components/shell/AppFrame';
import { AppTooltip } from './components/shell/AppTooltip';
import { CommandStrip } from './components/shell/CommandStrip';
import { ConfirmDialog } from './components/shell/ConfirmDialog';
import { ContentContextMenu } from './components/shell/ContentContextMenu';
import { MenuBar } from './components/shell/MenuBar';
import { SettingsDialog } from './components/shell/SettingsDialog';
import { StatusBar } from './components/shell/StatusBar';
import { TabStrip } from './components/shell/TabStrip';
import { Toolbar } from './components/shell/Toolbar';
import { WorkspaceSearchDialog } from './components/shell/WorkspaceSearchDialog';
import { DetailPane } from './components/results/DetailPane';
import { EmptyWorkspace } from './components/results/EmptyWorkspace';
import { OperationProgress } from './components/results/OperationProgress';
import { ResultTable } from './components/results/ResultTable';
import { WarningStrip, warningMessageFor } from './components/results/WarningStrip';
import { ToolForm } from './components/tools/ToolForm';
import { ToastHost } from './components/shell/ToastHost';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePopoverDismissal } from './hooks/usePopoverDismissal';
import { usePreferences } from './hooks/usePreferences';
import { useReleaseNotifications } from './hooks/useReleaseNotifications';
import { useTauriRuntimeState } from './hooks/useTauriRuntimeState';
import { appWindowAction, type AppWindowAction } from './services/appWindow';
import type { ResultCellContext } from './tools/types';
import { guardForOperation, type OperationGuard } from './workspace/operationGuards';
import { useWorkspace } from './workspace/useWorkspace';

const APP_VERSION = __APP_VERSION__;

function App() {
  const {
    commandBarVisible,
    darkMode,
    interactionToasts,
    operationToasts,
    persistentHistory,
    releaseNotifications,
    setCommandBarVisible,
    setDarkMode,
    setInteractionToasts,
    setOperationToasts,
    setPersistentHistory,
    setReleaseNotifications,
    setTrafficDisplayUnit,
    setTrafficIndicators,
    setTrafficPrecision,
    trafficDisplayUnit,
    trafficIndicators,
    trafficPrecision,
  } = usePreferences();
  const workspace = useWorkspace({ interactionToasts, operationToasts, persistentHistory });
  const activeTab = workspace.activeTab;
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
  const [dismissedWarningKeys, setDismissedWarningKeys] = useState<Record<string, true>>({});
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pendingRun, setPendingRun] = useState<{ tabId: string; guard: OperationGuard } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  useReleaseNotifications({
    appVersion: APP_VERSION,
    dismissToast: workspace.dismissToast,
    enabled: releaseNotifications,
    showUpdateToast: workspace.showUpdateToast,
    toast: workspace.toast,
  });

  usePopoverDismissal({ contentContextMenu, openMenu, setContentContextMenu, setOpenMenu });
  useKeyboardShortcuts({
    focusResultFilter: () => {
      filterInputRef.current?.focus({ preventScroll: true });
      filterInputRef.current?.select();
    },
    openMenu,
    setOpenMenu,
    setSettingsOpen,
    settingsOpen,
    setWorkspaceSearchOpen,
    workspace,
    workspaceSearchOpen,
  });

  function requestRun(tabId: string) {
    const tab = workspace.tabs.find((item) => item.id === tabId);
    if (tab?.kind === 'pcap' && !pcapCapability.available) return;
    const guard = guardForOperation(tab);
    if (guard) {
      setPendingRun({ tabId, guard });
      return;
    }
    void workspace.runTab(tabId);
  }

  function runActive() {
    if (activeTab) requestRun(activeTab.id);
  }

  function cancelActive() {
    if (activeTab) void workspace.cancelTab(activeTab.id);
  }

  function windowAction(action: AppWindowAction) {
    void appWindowAction(action);
  }

  function handleAppFrameMouseDown(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('button,input,select,a,[role="button"],.menu-popover')) return;
    void appWindowAction('drag');
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

  const warningMessage = !activeTab?.error ? warningMessageFor(activeTab?.result?.warnings) : null;
  const warningKey = activeTab && warningMessage ? `${activeTab.id}:${workspace.commandPreview}:${warningMessage}` : null;
  const showWarning = Boolean(warningKey && !dismissedWarningKeys[warningKey]);
  const pcapUnavailableReason =
    activeTab?.kind === 'pcap' && !pcapCapability.available
      ? packetCaptureUnavailableMessage(pcapCapability.message)
      : null;

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
        runDisabledReason={pcapUnavailableReason ?? undefined}
      />

      <TabStrip
        activeTabId={workspace.activeTabId}
        openMenu={openMenu}
        tabs={workspace.tabs}
        toolCapabilities={toolCapabilities}
        onAddScanTab={() => workspace.addTab('scan')}
        onAddToolTab={workspace.addTab}
        onCloseTab={workspace.closeTab}
        onSelectTab={workspace.setActiveTabId}
        setOpenMenu={setOpenMenu}
      />

      <main className="workspace">
        {activeTab ? (
          <>
            <section className="active-form">
              <ToolForm
                interfaces={workspace.interfaces}
                tab={activeTab}
                onPatchForm={workspace.patchForm}
                onRun={requestRun}
              />
            </section>

            {activeTab.error && <div className="error-strip">{activeTab.error}</div>}
            {showWarning && warningKey ? (
              <WarningStrip
                message={warningMessage ?? ''}
                onDismiss={() => setDismissedWarningKeys((prev) => ({ ...prev, [warningKey]: true }))}
              />
            ) : null}
            <section className="result-region">
              {activeTab.busy && <OperationProgress tab={activeTab} />}
              <ResultTable
                activeTab={activeTab}
                columns={workspace.columns}
                pcapCapability={pcapCapability}
                rows={workspace.rows}
                onContentContextMenu={openContentContextMenu}
                onSelectAllRows={workspace.selectAllRows}
                onSelectRow={workspace.selectRow}
                onSort={workspace.sortBy}
              />
            </section>

            <DetailPane
              activeTab={activeTab}
              columns={workspace.columns}
              selectedRow={workspace.selectedRow}
              selectedRows={workspace.selectedRows}
              onContentContextMenu={openContentContextMenu}
              onSetDetailTab={(detailTab) => workspace.patchTab(activeTab.id, { detailTab })}
            />

            {commandBarVisible && (
              <CommandStrip command={workspace.commandPreview} onCopy={() => void workspace.copyCommand()} />
            )}
          </>
        ) : (
          <EmptyWorkspace
            toolCapabilities={toolCapabilities}
            onAddToolTab={workspace.addTab}
          />
        )}
      </main>

      <StatusBar
        activeTab={activeTab}
        animateTrafficArrows={trafficIndicators}
        interfaceInfo={workspace.trafficInterface ?? workspace.defaultInterface}
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
      {contentContextMenu && (
        <ContentContextMenu
          canClear={Boolean(activeTab && (activeTab.result || activeTab.error))}
          canUseSelection={Boolean(activeTab?.result)}
          captureFilePath={activeTab?.result?.kind === 'pcap' ? activeTab.result.data.file_path : undefined}
          cell={contentContextMenu.cell}
          x={contentContextMenu.x}
          y={contentContextMenu.y}
          onClearResults={workspace.clearCurrentResults}
          onClose={() => setContentContextMenu(null)}
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
          animateTrafficArrows={trafficIndicators}
          commandBarVisible={commandBarVisible}
          darkMode={darkMode}
          defaultInterface={workspace.defaultInterface}
          interactionToasts={interactionToasts}
          interfaces={workspace.interfaces}
          operationToasts={operationToasts}
          persistentHistory={persistentHistory}
          releaseNotifications={releaseNotifications}
          trafficDisplayUnit={trafficDisplayUnit}
          fileSavePreferences={fileSavePreferences}
          trafficPrecision={trafficPrecision}
          trafficInterfaceName={workspace.trafficInterfaceName}
          onClose={() => setSettingsOpen(false)}
          onChooseSaveFolder={() => void chooseSaveFolder()}
          onClearSaveFolder={() => void clearSaveFolder()}
          onSelectTrafficInterface={workspace.setTrafficInterfaceName}
          onSetDarkMode={setDarkMode}
          onSetTrafficDisplayUnit={setTrafficDisplayUnit}
          onSetTrafficPrecision={setTrafficPrecision}
          onToggleFileSaveAskEachTime={() => void toggleFileSaveAskEachTime()}
          onToggleInteractionToasts={() => setInteractionToasts((prev) => !prev)}
          onToggleOperationToasts={() => setOperationToasts((prev) => !prev)}
          onTogglePersistentHistory={() => setPersistentHistory((prev) => !prev)}
          onToggleReleaseNotifications={() => setReleaseNotifications((prev) => !prev)}
          onToggleCommandBar={() => setCommandBarVisible((prev) => !prev)}
          onToggleTrafficArrowAnimation={() => setTrafficIndicators((prev) => !prev)}
        />
      )}
      {workspaceSearchOpen && (
        <WorkspaceSearchDialog
          history={workspace.history}
          tabs={workspace.tabs}
          onClose={() => setWorkspaceSearchOpen(false)}
          onOpenHistoryEntry={workspace.openHistoryEntry}
          onSelectTab={workspace.setActiveTabId}
          onSelectRow={(tabId, rowIndex) => {
            workspace.setActiveTabId(tabId);
            window.setTimeout(() => workspace.selectRow(rowIndex), 0);
          }}
        />
      )}
      {aboutOpen && <AboutDialog appVersion={APP_VERSION} onClose={() => setAboutOpen(false)} />}
      {pendingRun && (
        <ConfirmDialog
          confirmLabel={pendingRun.guard.confirmLabel}
          message={pendingRun.guard.message}
          title={pendingRun.guard.title}
          onCancel={() => setPendingRun(null)}
          onConfirm={() => {
            const tabId = pendingRun.tabId;
            setPendingRun(null);
            void workspace.runTab(tabId);
          }}
        />
      )}
      <AppTooltip />
    </div>
  );
}

function packetCaptureUnavailableMessage(message?: string | null): string {
  if (message?.includes("built without feature 'pcap'")) {
    return 'Packet Capture is not included in this build.';
  }
  return 'Packet Capture needs Npcap/libpcap before it can run.';
}

export default App;
