import type { PlatformInstall, Platform, SectionCopy, TryCommand } from './types';
import { INSTALL_PS1_COMMAND, INSTALL_SH_COMMAND } from './install-urls';

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
 * this now points at them.
 *
 * Stated as the exception rather than labelling its opposite. Every package
 * manager row used to carry a "Hash-verified" tag so this row would read as
 * different -- four copies of it in one Windows panel, saying the unremarkable
 * thing four times to make the remarkable thing stand out once. The
 * verification is the norm; not having it is the news, so only the news is
 * written down. */
const WINDOWS_UNSIGNED_HINT = 'Unsigned — SmartScreen may warn. Checksums are published.';

export const installByPlatform: Record<Platform, PlatformInstall> = {
  windows: {
    cli: [
      {
        label: 'Winget',
        command: 'winget install netscli',
      },
      {
        label: 'Scoop',
        command:
          'scoop bucket add fstubner https://github.com/fstubner/scoop-bucket && scoop install netscli',
      },
      {
        label: 'PowerShell script',
        command:
          INSTALL_PS1_COMMAND,
      },
    ],
    desktop: [
      {
        label: 'Winget',
        command: 'winget install netscli-gui',
      },
      {
        label: 'Scoop',
        command:
          'scoop bucket add fstubner https://github.com/fstubner/scoop-bucket && scoop install netscli-gui',
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
          INSTALL_SH_COMMAND,
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
          INSTALL_SH_COMMAND,
      },
      {
        label: 'AUR (Arch)',
        command: 'yay -S netscli-bin',
      },
      {
        label: 'Homebrew',
        command: 'brew tap fstubner/tap && brew install netscli',
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
    comment: 'Expose NetsCLI tools to Claude, Cursor, and other MCP clients',
    command: 'netscli serve',
  },
  {
    comment: 'List every CLI command and option',
    command: 'netscli --help',
  },
];

// The link lands on the section that actually carries the commands. It used
// to point at the top of the install guide, which had no verification steps
// anywhere on it -- the promise was real (assets are signed) but nobody
// following it could act on it.
/* One line, three jobs: the routes this panel no longer lists, the
 * verification steps, and the packet-capture builds. The panel used to carry
 * a Cargo row per platform -- the same command three times -- and every
 * alternative route for every platform, which is what made it read as a wall
 * rather than a choice. */
export const installBinariesNote =
  'Rust users can <code>cargo install netscli</code>. Every asset is checksummed and signed with <a href="https://docs.sigstore.dev/cosign/overview/">Sigstore cosign</a> — see <a href="/docs/install/#verifying-a-download">how to verify a download</a>, plus standalone binaries and packet-capture builds.';

// Two things /llms.txt says that no page does: a build-from-source route,
// listed after the per-platform quickstart, and any caveat a reader acting
// on that list needs. They live here because they are claims about the
// product, and a claim kept in the route file is one nobody edits when it
// stops being true.
export const installFromSource = 'cargo install netscli';

export const installNotes = [
  'Packet capture is a compile-time feature. No published desktop installer',
  'includes it; capture-enabled CLI assets are published separately and also',
  'need a system capture library (libpcap or Npcap).',
];
