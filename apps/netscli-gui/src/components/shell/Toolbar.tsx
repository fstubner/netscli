import { ChevronDown, Download, FileSpreadsheet, Filter, Play, Square } from 'lucide-react';

import { TOOL_CONFIG } from '../../tools/registry';
import { filterHintsFor } from '../../tools/presentation';
import type { ToolKind, WorkspaceTab } from '../../tools/types';

interface ToolbarProps {
  activeTab: WorkspaceTab | undefined;
  filterText: string;
  openMenu: string | null;
  setOpenMenu: (menu: string | null) => void;
  setFilterText: (value: string) => void;
  onCancelActive: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onRunActive: () => void;
}

export function Toolbar({
  activeTab,
  filterText,
  openMenu,
  setOpenMenu,
  setFilterText,
  onCancelActive,
  onExportCsv,
  onExportJson,
  onRunActive,
}: ToolbarProps) {
  const filterMenuOpen = openMenu === 'advanced-filter';
  const kind = activeTab?.kind ?? 'scan';
  const filterHints = filterHintsFor(activeTab);
  const runLabel = activeTab ? runLabelFor(kind) : 'Start';
  const applyFilter = (value: string) => {
    setFilterText(value);
    setOpenMenu(null);
  };

  return (
    <div className="toolbar">
      <button
        className="icon-button strong toolbar-run"
        data-testid="run-active-tab"
        disabled={!activeTab || activeTab.busy}
        aria-label={runLabel}
        data-tooltip={runLabel}
        data-tooltip-placement="bottom"
        onClick={onRunActive}
      >
        <Play size={16} />
        <span>{runLabel}</span>
      </button>
      <button
        className={`icon-button stop-button ${activeTab?.busy ? 'armed' : ''}`}
        disabled={!activeTab?.busy}
        aria-label="Stop current operation"
        data-tooltip="Stop current operation"
        data-tooltip-placement="bottom"
        onClick={onCancelActive}
      >
        <Square size={13} />
      </button>
      <div className="toolbar-separator" />
      <button
        className="icon-button"
        aria-label="Export JSON"
        data-testid="export-json-button"
        data-tooltip="Export JSON"
        data-tooltip-placement="bottom"
        disabled={!activeTab?.result}
        onClick={onExportJson}
      >
        <Download size={15} />
      </button>
      <button
        className="icon-button"
        aria-label="Export CSV"
        data-tooltip="Export CSV"
        data-tooltip-placement="bottom"
        disabled={!activeTab?.result}
        onClick={onExportCsv}
      >
        <FileSpreadsheet size={15} />
      </button>
      <div className="toolbar-spacer" />
      <div className="filter-control">
        <div className="filter-box">
          <Filter size={14} />
          <input
            autoCapitalize="off"
            autoCorrect="off"
            data-testid="result-filter"
            spellCheck={false}
            disabled={!activeTab}
            value={filterText}
            placeholder={filterHints.placeholder}
            onChange={(event) => setFilterText(event.target.value)}
          />
        </div>
        <button
          className={`filter-menu-button ${filterMenuOpen ? 'active' : ''}`}
          aria-label="Advanced filters"
          data-testid="advanced-filter-toggle"
          data-tooltip={filterMenuOpen ? undefined : 'Advanced filters'}
          data-tooltip-align="right"
          data-tooltip-placement="bottom"
          disabled={!activeTab}
          onClick={() => setOpenMenu(filterMenuOpen ? null : 'advanced-filter')}
        >
          <ChevronDown size={13} />
        </button>
        {filterMenuOpen && activeTab && (
          <div className="filter-advanced-popover" data-testid="advanced-filter-menu">
            <p className="filter-syntax-hint">
              Type tokens directly, e.g. <code>{filterHints.example}</code>.
              Prefix with <code>-</code> to exclude.
            </p>
            {filterHints.sections.map((section) => (
              <FilterSection
                key={section.label}
                label={section.label}
                options={section.options}
                onApply={applyFilter}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function runLabelFor(kind: ToolKind): string {
  if (kind === 'scan') return 'Start Scan';
  if (kind === 'pcap') return 'Start Capture';
  return TOOL_CONFIG[kind].action;
}

function FilterSection({
  label,
  options,
  onApply,
}: {
  label: string;
  options: Array<[string, string]>;
  onApply: (value: string) => void;
}) {
  return (
    <div className="filter-section">
      <span className="filter-section-label">{label}</span>
      {options.map(([labelText, value]) => (
        <button key={`${labelText}-${value}`} type="button" onClick={() => onApply(value)}>
          <span>{labelText}</span>
          <code>{value || '*'}</code>
        </button>
      ))}
    </div>
  );
}
