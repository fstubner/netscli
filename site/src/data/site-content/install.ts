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
 * this now points at them. */
const WINDOWS_UNSIGNED_HINT = 'Unsigned — SmartScreen may warn; checksums published';

/* Both of these check the download against a SHA256 in their own manifest
 * and abort on a mismatch, which is the thing the direct-download row cannot
 * do for you. Stated on both rather than only on winget: scoop does it too,
 * and naming one would have implied the other does not.
 *
 * Two words, not a sentence. It appears on four rows in a single Windows
 * panel -- winget and scoop, under both Desktop app and CLI -- and four
 * copies of "Verifies the download against the hash in its manifest" is most
 * of what made that panel read as a wall. The full explanation is in the
 * install guide; here it only has to distinguish these rows from the
 * download below them. */
const WINDOWS_MANAGER_HASH_HINT = 'Hash-verified';

export const installByPlatform: Record<Platform, PlatformInstall> = {
  windows: {
    cli: [
      {
        label: 'Winget',
        command: 'winget install netscli',
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
          INSTALL_PS1_COMMAND,
      },
    ],
    desktop: [
      {
        label: 'Winget',
        command: 'winget install netscli-gui',
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
