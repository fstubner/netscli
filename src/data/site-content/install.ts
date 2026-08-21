import type { PlatformInstall, Platform, SectionCopy, TryCommand } from './types';

export const installCopy: SectionCopy = {
  heading: 'Get started',
  leadHtml:
    'Install the desktop app or the command line — both drive the same Rust core. <a href="/docs/install/">Full install guide →</a>',
};

const RELEASE_DOWNLOAD = 'https://github.com/fstubner/netscli/releases/latest/download';

/** Shown on every direct .dmg / .msi row.
 *
 *  The desktop installers are not code-signed yet (tracked separately —
 *  notarization needs a paid Apple Developer cert, Authenticode needs a
 *  Windows cert). Warning up front is better than someone hitting a
 *  Gatekeeper or SmartScreen dialog with no context and assuming the
 *  download is malware. */
const MACOS_UNSIGNED_HINT = 'Unsigned — right-click → Open on first launch';
/* Describes the row it is attached to, which is the direct .msi download.
 * It used to end "winget verifies the hash" -- true of winget, and winget is
 * not what this row does. Someone clicking Download gets the installer
 * straight from GitHub Releases with nothing checking it, and was being told
 * otherwise at the moment they did it. The checksums are real and published;
 * this now points at them. */
const WINDOWS_UNSIGNED_HINT =
  'Unsigned — SmartScreen may warn; checksums are published with the release';

/* Both of these check the download against a SHA256 in their own manifest
 * and abort on a mismatch, which is the thing the direct-download row cannot
 * do for you. Stated on both rather than only on winget: scoop does it too,
 * and naming one would have implied the other does not. */
const WINDOWS_MANAGER_HASH_HINT = 'Verifies the download against the hash in its manifest';

export const installByPlatform: Record<Platform, PlatformInstall> = {
  windows: {
    cli: [
      {
        label: 'Winget',
        command: 'winget install fstubner.netscli',
        hint: WINDOWS_MANAGER_HASH_HINT,
      },
      {
        label: 'Scoop',
        command:
          'scoop bucket add fstubner https://github.com/fstubner/scoop-bucket && scoop install netscli',
        hint: WINDOWS_MANAGER_HASH_HINT,
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
    desktop: [
      {
        label: 'Winget',
        command: 'winget install fstubner.netscli.gui',
        hint: WINDOWS_MANAGER_HASH_HINT,
      },
      {
        label: 'Scoop',
        command:
          'scoop bucket add fstubner https://github.com/fstubner/scoop-bucket && scoop install netscli-gui',
        hint: WINDOWS_MANAGER_HASH_HINT,
      },
      {
        label: 'Installer',
        href: `${RELEASE_DOWNLOAD}/netscli-gui-windows-x86_64.msi`,
        hint: WINDOWS_UNSIGNED_HINT,
      },
    ],
  },
  macos: {
    cli: [
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
    desktop: [
      {
        // `--cask` because it is a cask, not because the name is
        // ambiguous. The token was `netscli`, colliding with the CLI
        // formula in the same tap; it is `netscli-gui` now, matching how
        // scoop, AUR and winget already name the two artifacts.
        label: 'Homebrew',
        command: 'brew install --cask fstubner/tap/netscli-gui',
      },
      {
        label: 'Apple Silicon',
        href: `${RELEASE_DOWNLOAD}/netscli-gui-macos-aarch64.dmg`,
        hint: MACOS_UNSIGNED_HINT,
      },
      {
        label: 'Intel',
        href: `${RELEASE_DOWNLOAD}/netscli-gui-macos-x86_64.dmg`,
        hint: MACOS_UNSIGNED_HINT,
      },
    ],
  },
  linux: {
    cli: [
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
    desktop: [
      {
        label: 'AUR (Arch)',
        command: 'yay -S netscli-gui-bin',
      },
      {
        label: 'AppImage',
        href: `${RELEASE_DOWNLOAD}/netscli-gui-linux-x86_64.AppImage`,
        hint: 'Any distro — chmod +x and run',
      },
      {
        label: 'Debian / Ubuntu',
        href: `${RELEASE_DOWNLOAD}/netscli-gui-linux-x86_64.deb`,
      },
    ],
  },
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
  'Every asset is checksummed and signed with <a href="https://docs.sigstore.dev/cosign/overview/">Sigstore cosign</a> — see <a href="/docs/install/">the install guide</a> for verification steps, standalone CLI binaries, and packet-capture builds.';
