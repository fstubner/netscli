import { useRef } from 'react';
import {
  Activity,
  Bell,
  FolderOpen,
  Moon,
  Network,
  Palette,
  Shield,
  Sun,
  X,
} from 'lucide-react';

import type { DefaultInterfaceInfo, FileSavePreferences, InterfaceInfo } from '../../types/netscli';
import type {
  AddressPreference,
  MaxConcurrentProbes,
  TrafficDisplayUnit,
  TrafficPrecision,
} from '../../hooks/usePreferences';
import { useModalFocus } from '../primitives/focus';
import { NetworkInterfacePicker, SettingsNumberInput, SettingsSelect, SettingsSwitch } from './SettingsControls';

interface SettingsDialogProps {
  animateTrafficArrows: boolean;
  addressPreference: AddressPreference;
  commandBarVisible: boolean;
  darkMode: boolean;
  defaultInterface: DefaultInterfaceInfo | null;
  fileSavePreferences: FileSavePreferences;
  interactionToasts: boolean;
  interfaces: InterfaceInfo[];
  maxConcurrentProbes: MaxConcurrentProbes;
  operationToasts: boolean;
  persistentHistory: boolean;
  releaseNotifications: boolean;
  trafficDisplayUnit: TrafficDisplayUnit;
  trafficInterfaceName: string | null;
  trafficPrecision: TrafficPrecision;
  onClose: () => void;
  onChooseSaveFolder: () => void;
  onClearSaveFolder: () => void;
  onSelectTrafficInterface: (name: string) => void;
  onSetAddressPreference: (preference: AddressPreference) => void;
  onSetDarkMode: (enabled: boolean) => void;
  onSetMaxConcurrentProbes: (value: MaxConcurrentProbes) => void;
  onSetTrafficDisplayUnit: (unit: TrafficDisplayUnit) => void;
  onSetTrafficPrecision: (precision: TrafficPrecision) => void;
  onToggleFileSaveAskEachTime: () => void;
  onToggleInteractionToasts: () => void;
  onToggleOperationToasts: () => void;
  onTogglePersistentHistory: () => void;
  onToggleReleaseNotifications: () => void;
  onToggleCommandBar: () => void;
  onToggleTrafficArrowAnimation: () => void;
}

function defaultSaveFolderLabel(): string {
  if (typeof navigator === 'undefined') return 'Downloads/NetsCLI';
  const platform = navigator.platform || '';
  if (/win/i.test(platform)) return 'Downloads\\NetsCLI';
  if (/mac/i.test(platform)) return '~/Downloads/NetsCLI';
  return '~/Downloads/NetsCLI';
}

export function SettingsDialog({
  animateTrafficArrows,
  addressPreference,
  commandBarVisible,
  darkMode,
  defaultInterface,
  fileSavePreferences,
  interactionToasts,
  interfaces,
  maxConcurrentProbes,
  operationToasts,
  persistentHistory,
  releaseNotifications,
  trafficDisplayUnit,
  trafficInterfaceName,
  trafficPrecision,
  onClose,
  onChooseSaveFolder,
  onClearSaveFolder,
  onSelectTrafficInterface,
  onSetAddressPreference,
  onSetDarkMode,
  onSetMaxConcurrentProbes,
  onSetTrafficDisplayUnit,
  onSetTrafficPrecision,
  onToggleFileSaveAskEachTime,
  onToggleInteractionToasts,
  onToggleOperationToasts,
  onTogglePersistentHistory,
  onToggleReleaseNotifications,
  onToggleCommandBar,
  onToggleTrafficArrowAnimation,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);

  useModalFocus({ dialogRef, onClose });

  return (
    <div className="settings-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-dialog"
        data-testid="settings-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <div>
            <h2 id="settings-title">Settings</h2>
            <p>Preferences for the desktop shell and local status indicators.</p>
          </div>
          <button className="settings-close" aria-label="Close Settings" data-tooltip="Close Settings" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <div className="settings-dialog-body">
          <section className="settings-section">
            <span className="settings-section-label">
              <Palette size={13} />
              Appearance
            </span>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span>Theme</span>
                <small>{darkMode ? 'Dark interface palette' : 'Light interface palette'}</small>
              </div>
              <button
                aria-checked={darkMode}
                className={`theme-switch ${darkMode ? 'dark' : 'light'}`}
                data-testid="settings-theme-toggle"
                role="switch"
                type="button"
                onClick={() => onSetDarkMode(!darkMode)}
              >
                <span className="theme-switch-track">
                  <span className="theme-switch-thumb">{darkMode ? <Moon size={13} /> : <Sun size={13} />}</span>
                </span>
                <span>{darkMode ? 'Dark' : 'Light'}</span>
              </button>
            </div>
            <SettingsSwitch
              checked={commandBarVisible}
              label="CLI Command Bar"
              note="Show the equivalent command under the result panes."
              testId="settings-command-bar-toggle"
              onClick={onToggleCommandBar}
            />
          </section>

          <section className="settings-section">
            <span className="settings-section-label">
              <Bell size={13} />
              Notifications
            </span>
            <SettingsSwitch
              checked={interactionToasts}
              label="Interaction Toasts"
              note="Confirm copy, export, and preference actions."
              testId="settings-interaction-toasts-toggle"
              onClick={onToggleInteractionToasts}
            />
            <SettingsSwitch
              checked={operationToasts}
              label="Operation Toasts"
              note="Report when scans and lookups start, finish, or fail."
              testId="settings-operation-toasts-toggle"
              onClick={onToggleOperationToasts}
            />
            <SettingsSwitch
              checked={releaseNotifications}
              label="Release Notifications"
              note="Check GitHub for newer NetsCLI releases."
              testId="settings-release-notifications-toggle"
              onClick={onToggleReleaseNotifications}
            />
          </section>

          <section className="settings-section">
            <span className="settings-section-label">
              <Activity size={13} />
              Network Operations
            </span>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span>Max Concurrent Probes</span>
                <small>Upper limit for simultaneous scan, discover, and sweep probes.</small>
              </div>
              <SettingsNumberInput
                label="Max Concurrent Probes"
                testId="settings-max-concurrent-probes"
                value={maxConcurrentProbes}
                onChange={onSetMaxConcurrentProbes}
              />
            </div>
          </section>

          <section className="settings-section">
            <span className="settings-section-label">
              <Shield size={13} />
              Privacy
            </span>
            <SettingsSwitch
              checked={persistentHistory}
              label="Save History"
              note="Keep command history and result snapshots between app restarts. Turning this off clears saved runs immediately."
              testId="settings-persistent-history-toggle"
              onClick={onTogglePersistentHistory}
            />
          </section>

          <section className="settings-section">
            <span className="settings-section-label">
              <FolderOpen size={13} />
              Saving
            </span>
            <SettingsSwitch
              checked={fileSavePreferences.ask_each_time}
              label="Ask Where To Save"
              note="Prompt before exporting CSV/JSON or saving packet captures."
              testId="settings-save-ask-toggle"
              onClick={onToggleFileSaveAskEachTime}
            />
            <div className="settings-folder-row">
              <div className="settings-row-copy">
                <span>Default Save Folder</span>
                <small>{fileSavePreferences.default_directory ?? defaultSaveFolderLabel()}</small>
              </div>
              <div className="settings-folder-actions">
                <button
                  data-testid="settings-save-folder-button"
                  type="button"
                  onClick={onChooseSaveFolder}
                >
                  Choose Folder
                </button>
                <button
                  data-testid="settings-save-folder-clear"
                  disabled={!fileSavePreferences.default_directory}
                  type="button"
                  onClick={onClearSaveFolder}
                >
                  Reset
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <span className="settings-section-label">
              <Network size={13} />
              Network Activity
            </span>
            <SettingsSwitch
              checked={animateTrafficArrows}
              label="Activity Animation"
              note="Flicker the status-bar arrows only when sampled traffic changes."
              testId="settings-activity-animation-toggle"
              onClick={onToggleTrafficArrowAnimation}
            />
            <div className="settings-row">
              <div className="settings-row-copy">
                <span>Traffic Units</span>
                <small>Unit shown beside status-bar upload and download rates.</small>
              </div>
              <SettingsSelect
                label="Traffic Units"
                testId="settings-traffic-unit"
                value={trafficDisplayUnit}
                options={[
                  { value: 'Gbps', label: 'Gbps' },
                  { value: 'Mbps', label: 'Mbps' },
                  { value: 'Kbps', label: 'Kbps' },
                ]}
                onSelect={(value) => onSetTrafficDisplayUnit(value as TrafficDisplayUnit)}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span>Traffic Precision</span>
                <small>Decimal places for status-bar traffic rates.</small>
              </div>
              <SettingsSelect
                label="Traffic Precision"
                testId="settings-traffic-precision"
                value={String(trafficPrecision)}
                options={[
                  { value: '0', label: '0 decimals' },
                  { value: '1', label: '1 decimal' },
                  { value: '2', label: '2 decimals' },
                ]}
                onSelect={(value) => onSetTrafficPrecision(Number(value) as TrafficPrecision)}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span>Network Interface</span>
                <small>Interface used for status-bar traffic rates.</small>
              </div>
              <NetworkInterfacePicker
                compact
                defaultInterface={defaultInterface}
                interfaces={interfaces}
                selectedName={trafficInterfaceName}
                onSelect={onSelectTrafficInterface}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span>Address Preference</span>
                <small>Address family shown beside the selected interface.</small>
              </div>
              <SettingsSelect
                label="Address Preference"
                testId="settings-address-preference"
                value={addressPreference}
                options={[
                  { value: 'ipv4', label: 'IPv4 first' },
                  { value: 'ipv6', label: 'IPv6 first' },
                ]}
                onSelect={(value) => onSetAddressPreference(value as AddressPreference)}
              />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
