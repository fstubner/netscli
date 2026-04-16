import { Toggle } from '../components/Toggle';

export function SettingsView(props: {
  darkMode: boolean;
  onDarkModeChange: (dark: boolean) => void;
  version: string;
}) {
  const { darkMode, onDarkModeChange, version } = props;

  // Tauri provides these via import.meta.env if we wanted them dynamic.
  // For now the constants match what ships in Cargo.toml + rust-toolchain.toml.
  const specs = [
    { label: 'Version', value: version },
    { label: 'Built with', value: 'Rust 1.92 · Tauri 2 · React 19' },
    { label: 'License', value: 'MIT' },
  ];

  const shortcuts = [
    { keys: 'Ctrl + 1–9', action: 'Switch between tabs' },
    { keys: 'Ctrl + E', action: 'Export current results' },
    { keys: 'Ctrl + D', action: 'Toggle dark / light mode' },
    { keys: 'Ctrl + ,', action: 'Open preferences' },
  ];

  return (
    <div className="settings">
      <h1 className="settings-page-title">Settings</h1>

      <div className="settings-section">
        <h3>Appearance</h3>
        <p className="settings-help">
          Controls the application's color theme. Applies immediately.
        </p>
        <div className="settings-item">
          <Toggle checked={darkMode} onChange={onDarkModeChange} label="Dark Mode" />
        </div>
      </div>

      <div className="settings-section">
        <h3>Keyboard Shortcuts</h3>
        <p className="settings-help">
          These shortcuts work anywhere in the app.
        </p>
        <ul className="shortcut-list" role="list">
          {shortcuts.map((s) => (
            <li key={s.keys} className="shortcut-row">
              <kbd className="shortcut-keys">{s.keys}</kbd>
              <span className="shortcut-action">{s.action}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="settings-section">
        <h3>About</h3>
        <dl className="spec-list">
          {specs.map((spec) => (
            <div key={spec.label} className="spec-row">
              <dt className="spec-label">{spec.label}</dt>
              <dd className="spec-value">{spec.value}</dd>
            </div>
          ))}
        </dl>
        <p className="settings-help">
          NetsCLI is a network scanner built in Rust with a matching CLI, TUI, and MCP
          server. Source:{' '}
          <a
            href="https://github.com/fstubner/netscli"
            target="_blank"
            rel="noopener noreferrer"
            className="settings-link"
          >
            github.com/fstubner/netscli
          </a>
          .
        </p>
      </div>
    </div>
  );
}
