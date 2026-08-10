import type { InstallEntry, Platform, SectionCopy, TryCommand } from './types';

export const installCopy: SectionCopy = {
  heading: 'Get started',
  leadHtml:
    'Install NetsCLI, then run a scan or lookup from the desktop app, TUI, or CLI. <a href="/docs/">Full docs →</a>',
};

export const installByPlatform: Record<Platform, InstallEntry[]> = {
  windows: [
    {
      label: 'Winget',
      command: 'winget install fstubner.netscli',
    },
    {
      label: 'Scoop',
      command:
        'scoop bucket add fstubner https://github.com/fstubner/scoop-bucket && scoop install netscli',
    },
    {
      label: 'PowerShell script',
      command:
        'iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex',
    },
    {
      label: 'Cargo',
      command: 'cargo install netscli',
    },
  ],
  macos: [
    {
      label: 'Homebrew',
      command: 'brew tap fstubner/tap && brew install netscli',
    },
    {
      label: 'Install script',
      command:
        'curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash',
    },
    {
      label: 'Cargo',
      command: 'cargo install netscli',
    },
  ],
  linux: [
    {
      label: 'Install script',
      command:
        'curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash',
    },
    {
      label: 'AUR (Arch)',
      command: 'yay -S netscli-bin',
    },
    {
      label: 'Homebrew',
      command: 'brew tap fstubner/tap && brew install netscli',
    },
    {
      label: 'Cargo',
      command: 'cargo install netscli',
    },
  ],
};

export const tryCommands: TryCommand[] = [
  {
    comment: 'Find live hosts on your current network',
    command: 'netscli discover',
  },
  {
    comment: 'Open the interactive terminal UI',
    command: 'netscli',
  },
  {
    comment: 'Check common TCP services on a router or host',
    command: 'netscli scan router.local -p 22,80,443',
  },
  {
    comment: 'Resolve DNS records with structured output available',
    command: 'netscli dns google.com',
  },
  {
    comment: 'Expose NetsCLI tools to Claude, Cursor, and other MCP clients',
    command: 'netscli serve',
  },
  {
    comment: 'List every CLI command and option',
    command: 'netscli --help',
  },
];

export const installBinariesNote =
  'Or grab CLI binaries and desktop installers (<code>.msi</code> / <code>.dmg</code> / <code>.deb</code> / <code>.AppImage</code>) from <a href="https://github.com/fstubner/netscli/releases/latest">the latest release</a>.';
