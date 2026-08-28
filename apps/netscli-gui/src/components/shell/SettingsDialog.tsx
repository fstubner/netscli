import { useRef } from 'react';
import {
  Activity,
  Bell,
  FolderOpen,
  Moon,
  Palette,
  Shield,
  Sun,
  X,
} from 'lucide-react';

import type { DefaultInterfaceInfo, FileSavePreferences, InterfaceInfo } from '../../types/netscli';
import type { Preferences } from '../../hooks/usePreferences';
import { useModalFocus } from '../primitives/focus';
import { NetworkActivitySection } from './NetworkActivitySection';
import { SettingsNumberInput, SettingsSwitch } from './SettingsControls';

interface SettingsDialogProps {
  /** Read and written directly; the settings dialog is the one place that
   *  touches most of these, so unpacking them into props gained nothing. */
  preferences: Preferences;
  defaultInterface: DefaultInterfaceInfo | null;
  fileSavePreferences: FileSavePreferences;
  interfaces: InterfaceInfo[];
  trafficInterfaceName: string | null;
  onClose: () => void;
  onChooseSaveFolder: () => void;
  onClearSaveFolder: () => void;
  onSelectTrafficInterface: (name: string) => void;
  onToggleFileSaveAskEachTime: () => void;
  onTogglePersistentHistory: () => void;
}

function defaultSaveFolderLabel(): string {
  if (typeof navigator === 'undefined') return 'Downloads/NetsCLI';
  const platform = navigator.platform || '';
  if (/win/i.test(platform)) return 'Downloads\\NetsCLI';
  if (/mac/i.test(platform)) return '~/Downloads/NetsCLI';
  return '~/Downloads/NetsCLI';
}

export function SettingsDialog({
  preferences,
  defaultInterface,
  fileSavePreferences,
  interfaces,
  trafficInterfaceName,
  onClose,
  onChooseSaveFolder,
  onClearSaveFolder,
  onSelectTrafficInterface,
  onToggleFileSaveAskEachTime,
  onTogglePersistentHistory,
}: SettingsDialogProps) {
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
    trafficPrecision,
  } = preferences;
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
                onClick={() => preferences.setDarkMode(!darkMode)}
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
              onClick={() => preferences.setCommandBarVisible((prev) => !prev)}
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
              onClick={() => preferences.setInteractionToasts((prev) => !prev)}
            />
            <SettingsSwitch
              checked={operationToasts}
              label="Operation Toasts"
              note="Report when scans and lookups start, finish, or fail."
              testId="settings-operation-toasts-toggle"
              onClick={() => preferences.setOperationToasts((prev) => !prev)}
            />
            <SettingsSwitch
              checked={releaseNotifications}
              label="Release Notifications"
              note="Check GitHub for newer NetsCLI releases."
              testId="settings-release-notifications-toggle"
              onClick={() => preferences.setReleaseNotifications((prev) => !prev)}
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
                onChange={preferences.setMaxConcurrentProbes}
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

          <NetworkActivitySection
            addressPreference={addressPreference}
            animateTrafficArrows={preferences.trafficIndicators}
            defaultInterface={defaultInterface}
            interfaces={interfaces}
            trafficDisplayUnit={trafficDisplayUnit}
            trafficInterfaceName={trafficInterfaceName}
            trafficPrecision={trafficPrecision}
            onSelectTrafficInterface={onSelectTrafficInterface}
            onSetAddressPreference={preferences.setAddressPreference}
            onSetTrafficDisplayUnit={preferences.setTrafficDisplayUnit}
            onSetTrafficPrecision={preferences.setTrafficPrecision}
            onToggleTrafficArrowAnimation={() => preferences.setTrafficIndicators((prev) => !prev)}
          />
        </div>
      </section>
    </div>
  );
}
