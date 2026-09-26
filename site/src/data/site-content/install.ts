import type { PlatformInstall, Platform, SectionCopy, TryCommand } from './types';
import { INSTALL_PS1_COMMAND, INSTALL_SH_COMMAND } from './install-urls';

export const installCopy: SectionCopy = {
  heading: 'Get started',
  leadHtml:
    'Install the desktop app or the command line — both drive the same Rust core. <a href="/docs/install/">Full install guide →</a>',
};

const RELEASE_DOWNLOAD = 'https://github.com/fstubner/netscli/releases/latest/download';

/** Shown on the direct .dmg rows.
 *
 *  The macOS app is not notarized (that needs a paid Apple Developer
 *  account). Warning up front is better than someone hitting a Gatekeeper
 *  dialog with no context and assuming the download is malware. */
const MACOS_UNSIGNED_HINT = 'Unsigned — right-click → Open on first launch';
/* Describes the row it is attached to, which is the direct .msi download.
 *
 * It said "Unsigned -- SmartScreen may warn. Checksums are published." until
 * after 0.3.3, the first release with an Authenticode-signed .msi: the one
 * place on the site still saying so once the install docs were corrected.
 * A new certificate has no SmartScreen reputation yet, so the warning stays,
 * as a "may". (Earlier still it ended "winget verifies the hash", true of
 * winget and not of a direct download.)
 *
 * Stated as the exception rather than labelling its opposite: the package
 * manager rows carry no "Signed" or "Hash-verified" tag, because that is the
 * norm there; only the row that differs says anything. */
const WINDOWS_INSTALLER_HINT = 'Signed. SmartScreen may still warn while the certificate is new.';

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
        hint: WINDOWS_INSTALLER_HINT,
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
    /* Distro-agnostic first, then Homebrew, then the Arch-only route. Same
     * reasoning as the desktop list above: AUR sat second, ahead of a package
     * manager that works on every distro. */
    cli: [
      {
        label: 'Install script',
        command:
          INSTALL_SH_COMMAND,
      },
      {
        label: 'Homebrew',
        command: 'brew tap fstubner/tap && brew install netscli',
      },
      {
        label: 'AUR (Arch)',
        command: 'yay -S netscli-bin',
      },
    ],
    /* Debian and Ubuntu first, then a distro-agnostic AppImage, then Arch.
     *
     * The first entry is the recommended one and renders as the big card, so
     * the order is a recommendation rather than a list. It used to lead with
     * `yay -S netscli-gui-bin`, which recommended Arch to everyone running
     * Linux -- a minority path presented as the default, with the .deb most
     * readers actually wanted buried two rows below it. */
    desktop: [
      {
        label: 'Debian / Ubuntu (.deb)',
        href: `${RELEASE_DOWNLOAD}/netscli-gui-linux-x86_64.deb`,
      },
      {
        label: 'AppImage',
        href: `${RELEASE_DOWNLOAD}/netscli-gui-linux-x86_64.AppImage`,
        hint: 'Any distro — chmod +x and run',
      },
      {
        label: 'AUR (Arch)',
        command: 'yay -S netscli-gui-bin',
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
