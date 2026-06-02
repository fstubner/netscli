import { useRef } from 'react';
import {
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
import { useModalFocus } from '../primitives/focus';
import { NetworkInterfacePicker, SettingsSwitch } from './SettingsControls';

interface SettingsDialogProps {
  animateTrafficArrows: boolean;
  commandBarVisible: boolean;
  darkMode: boolean;
  defaultInterface: DefaultInterfaceInfo | null;
  fileSavePreferences: FileSavePreferences;
  interactionToasts: boolean;
  interfaces: InterfaceInfo[];
  operationToasts: boolean;
  persistentHistory: boolean;
  releaseNotifications: boolean;
  trafficInterfaceName: string | null;
  onClose: () => void;
  onChooseSaveFolder: () => void;
  onClearSaveFolder: () => void;
  onSelectTrafficInterface: (name: string) => void;
  onSetDarkMode: (enabled: boolean) => void;
  onToggleFileSaveAskEachTime: () => void;
  onToggleInteractionToasts: () => void;
  onToggleOperationToasts: () => void;
  onTogglePersistentHistory: () => void;
  onToggleReleaseNotifications: () => void;
  onToggleCommandBar: () => void;
  onToggleTrafficArrowAnimation: () => void;
}

export function SettingsDialog({
  animateTrafficArrows,
  commandBarVisible,
  darkMode,
  defaultInterface,
  fileSavePreferences,
  interactionToasts,
  interfaces,
  operationToasts,
  persistentHistory,
  releaseNotifications,
  trafficInterfaceName,
  onClose,
  onChooseSaveFolder,
  onClearSaveFolder,
  onSelectTrafficInterface,
  onSetDarkMode,
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
              <Shield size={13} />
              Privacy
            </span>
            <SettingsSwitch
              checked={persistentHistory}
              label="Save History"
              note="Keep command history and result snapshots between app restarts."
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
                <small>{fileSavePreferences.default_directory ?? 'Downloads\\NetsCLI'}</small>
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
            <NetworkInterfacePicker
              defaultInterface={defaultInterface}
              interfaces={interfaces}
              selectedName={trafficInterfaceName}
              onSelect={onSelectTrafficInterface}
            />
          </section>
        </div>
      </section>
    </div>
  );
}
