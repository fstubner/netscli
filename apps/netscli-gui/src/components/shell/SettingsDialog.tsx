import { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  Moon,
  Network,
  Palette,
  Shield,
  Sun,
  X,
} from 'lucide-react';

import type { DefaultInterfaceInfo, InterfaceInfo } from '../../types/netscli';

interface SettingsDialogProps {
  animateTrafficArrows: boolean;
  commandBarVisible: boolean;
  darkMode: boolean;
  defaultInterface: DefaultInterfaceInfo | null;
  interactionToasts: boolean;
  interfaces: InterfaceInfo[];
  operationToasts: boolean;
  persistentHistory: boolean;
  releaseNotifications: boolean;
  trafficInterfaceName: string | null;
  onClose: () => void;
  onSelectTrafficInterface: (name: string) => void;
  onSetDarkMode: (enabled: boolean) => void;
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
  interactionToasts,
  interfaces,
  operationToasts,
  persistentHistory,
  releaseNotifications,
  trafficInterfaceName,
  onClose,
  onSelectTrafficInterface,
  onSetDarkMode,
  onToggleInteractionToasts,
  onToggleOperationToasts,
  onTogglePersistentHistory,
  onToggleReleaseNotifications,
  onToggleCommandBar,
  onToggleTrafficArrowAnimation,
}: SettingsDialogProps) {
  const [interfacePickerOpen, setInterfacePickerOpen] = useState(false);
  const selectedInterface = interfaces.find((iface) => iface.name === trafficInterfaceName);
  const selectedInterfaceName = selectedInterface?.name ?? trafficInterfaceName ?? '';
  const selectedInterfaceDetail = selectedInterface
    ? formatInterfaceDetail(selectedInterface)
    : 'Detecting...';

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="settings-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-dialog"
        data-testid="settings-dialog"
        role="dialog"
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
            <div className="settings-interface-field">
              <button
                className={`settings-interface-trigger ${interfacePickerOpen ? 'active' : ''}`}
                data-interface-name={selectedInterfaceName}
                data-interface-up={selectedInterface?.is_up ? 'true' : 'false'}
                data-testid="settings-interface-trigger"
                type="button"
                onClick={() => setInterfacePickerOpen((open) => !open)}
              >
                <span>
                  <span>Network Interface</span>
                  <small>
                    {selectedInterfaceName
                      ? `${selectedInterfaceName} - ${selectedInterfaceDetail}`
                      : 'Detecting...'}
                  </small>
                </span>
                <ChevronDown size={13} />
              </button>
              {interfacePickerOpen && (
                <div className="settings-interface-list" role="listbox" aria-label="Network Interface">
                  {interfaces.length === 0 && <span className="settings-empty">Detecting...</span>}
                  {interfaces.map((iface) => {
                    const selected = iface.name === selectedInterfaceName;
                    const isDefault = iface.name === defaultInterface?.name;

                    return (
                      <button
                        className={`settings-interface-option ${selected ? 'selected' : ''}`}
                        data-interface-name={iface.name}
                        data-interface-up={iface.is_up ? 'true' : 'false'}
                        data-testid="settings-interface-option"
                        key={iface.name}
                        role="option"
                        aria-selected={selected}
                        type="button"
                        onClick={() => {
                          onSelectTrafficInterface(iface.name);
                          setInterfacePickerOpen(false);
                        }}
                      >
                        <span className="settings-interface-main">
                          <span>{iface.name}</span>
                          <small>{formatInterfaceDetail(iface)}</small>
                        </span>
                        <span className="settings-interface-badges">
                          {isDefault && <span className="settings-interface-badge">Default</span>}
                          {selected && (
                            <span className="settings-interface-badge selected">
                              <Check size={11} />
                              Selected
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

interface SettingsSwitchProps {
  checked: boolean;
  label: string;
  note: string;
  testId: string;
  onClick: () => void;
}

function SettingsSwitch({
  checked,
  label,
  note,
  testId,
  onClick,
}: SettingsSwitchProps) {
  return (
    <label
      aria-checked={checked}
      className="settings-checkbox-row"
      data-testid={testId}
      role="checkbox"
    >
      <input checked={checked} type="checkbox" onChange={onClick} />
      <span className="settings-row-copy">
        <span>{label}</span>
        <small>{note}</small>
      </span>
      <span className="settings-checkbox-box" aria-hidden="true">
        {checked && <Check size={12} />}
      </span>
    </label>
  );
}

function formatInterfaceDetail(iface: InterfaceInfo): string {
  const status = iface.is_up ? 'Up' : 'Down';
  const addresses = iface.ips.length > 0 ? iface.ips.slice(0, 2).join(', ') : 'No address';
  return `${addresses} - ${status}`;
}
