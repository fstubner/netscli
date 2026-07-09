import { useState, type MouseEvent } from 'react';

import { DetailPane } from '../results/DetailPane';
import { EmptyWorkspace } from '../results/EmptyWorkspace';
import { OperationProgress } from '../results/OperationProgress';
import { ResultTable } from '../results/ResultTable';
import { WarningStrip, warningMessageFor } from '../results/WarningStrip';
import { ToolForm } from '../tools/ToolForm';
import { CommandStrip } from './CommandStrip';
import type { ResultCellContext, ToolCapabilityMap } from '../../tools/types';
import type { PcapCapability } from '../../types/netscli';
import type { WorkspaceModel } from '../../workspace/types';

interface WorkspaceViewProps {
  commandBarVisible: boolean;
  pcapCapability: PcapCapability;
  toolCapabilities: ToolCapabilityMap;
  workspace: WorkspaceModel;
  onContentContextMenu: (event: MouseEvent<HTMLElement>, cell?: ResultCellContext) => void;
  onRequestRun: (tabId: string) => void;
}

export function WorkspaceView({
  commandBarVisible,
  pcapCapability,
  toolCapabilities,
  workspace,
  onContentContextMenu,
  onRequestRun,
}: WorkspaceViewProps) {
  const [dismissedWarningKeys, setDismissedWarningKeys] = useState<Record<string, true>>({});
  const activeTab = workspace.activeTab;
  const warningMessage = !activeTab?.error ? warningMessageFor(activeTab?.result?.warnings) : null;
  const warningKey = activeTab && warningMessage ? `${activeTab.id}:${workspace.commandPreview}:${warningMessage}` : null;
  const showWarning = Boolean(warningKey && !dismissedWarningKeys[warningKey]);

  return (
    <main className="workspace">
      {activeTab ? (
        <>
          <section className="active-form">
            <ToolForm
              interfaces={workspace.interfaces}
              tab={activeTab}
              onPatchForm={workspace.patchForm}
              onRun={onRequestRun}
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
              onContentContextMenu={onContentContextMenu}
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
            onContentContextMenu={onContentContextMenu}
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
  );
}
