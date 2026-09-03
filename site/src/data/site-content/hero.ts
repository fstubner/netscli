import type { Hero, HeroCommands, HeroDownload } from './types';
import { INSTALL_PS1_COMMAND, INSTALL_SH_COMMAND } from './install-urls';

export const hero: Hero = {
  // Platforms only. "Open source" and "MIT" repeat in the footer and the
  // FAQ, and "Rust" is in the subhead one line below ("the same Rust core"),
  // so the badge was spending four items to deliver one piece of new
  // information. The platform list is the part a visitor cannot get anywhere
  // else above the fold.
  badge: 'Windows · Linux · macOS',
  // The H1 is the strongest on-page signal after the title, and this one used
  // to be "A modern network scanner" -- no brand, no differentiator, and
  // "modern" is not a word anyone searches for. Naming the surfaces says what
  // is actually different about it, and "AI agents" carries the MCP server in
  // language a visitor who has never heard of MCP still understands.
  heading: 'A network scanner for the desktop, the terminal, and AI agents',
  subhead:
    // Packet capture is scoped deliberately. Listing it alongside the other
    // operations claimed it works "from the desktop app, terminal UI, CLI, or
    // MCP server", and no published desktop installer has capture compiled in
    // at all -- a visitor could install from this page, go looking for it, and
    // find nothing. The capture-enabled CLI assets are real and published, so
    // the feature stays on the page; it just no longer implies the download
    // above it includes it.
    // Two things are deliberately absent.
    //
    // TRACEROUTE. The sentence attributes every operation it names to all
    // four interfaces, and the MCP server has no traceroute tool at all --
    // /docs/interface-coverage/ says so outright. The list is illustrative
    // rather than exhaustive (it omits ping, sweep, ARP and mDNS too), so
    // dropping the one operation that does not hold for all four is cheaper
    // than qualifying it.
    //
    // PACKET CAPTURE. This used to end "with packet capture in
    // capture-enabled CLI builds", a clause added because an earlier version
    // listed capture alongside the rest and so implied the desktop installer
    // above it included capture, which no published one does. Saying nothing
    // makes no claim at all, which is the same protection for a third of the
    // length -- and capture is covered properly in the FAQ and the install
    // guide, which is where someone looking for it will be.
    //
    // 242 characters and three lines before; the second sentence went with
    // it. "All on one Rust core" carries the same point as "each interface
    // calls the same Rust core, so results stay consistent" -- the reader who
    // needs the longer version is already reading /docs/.
    'Discover LAN devices, scan TCP ports, query DNS, and inspect hosts from the desktop app, terminal UI, CLI, or MCP server — all on one Rust core.',
  // `winget install netscli` leads, and the shell script follows.
  //
  // os-tabs.ts already swapped these per-OS at runtime -- Windows visitors
  // got the winget line and the script moved down. But the SERVER-rendered
  // default was the `curl … | bash` pipeline, so the most prominent command
  // on the page was a bash pipeline until JavaScript ran, and stayed one for
  // anyone without it and for every crawler reading the HTML.
  //
  // `netscli`, not `fstubner.netscli`: `Moniker: netscli` is published in the
  // winget catalog, so the short form resolves. The canonical identifier
  // stays in the install guide for anyone who wants to be unambiguous.
  quickInstall: 'winget install netscli',
  quickInstallAlt: INSTALL_SH_COMMAND,
  installLinkLabel: 'More install options ↓',
  heroImage: '/assets/tui-discover.png',
  heroImageWebp: '/assets/tui-discover.webp',
  heroImageAlt:
    'netscli terminal UI running /discover with sanitized lab hostnames, vendors, and response times',
  heroImageWidth: 1640,
  heroImageHeight: 930,
  sourceUrl: 'https://github.com/fstubner/netscli',
  downloadLabel: 'Desktop app',
  downloadMenuLabel: 'Choose desktop installer',
};

const RELEASE_DOWNLOAD = 'https://github.com/fstubner/netscli/releases/latest/download';

// The desktop installers, in menu order. The first entry is also what the
// server renders into the button before any script runs, so it has to be a
// file that exists rather than a placeholder.
//
// macOS ships two .dmgs and they are NOT interchangeable. The Intel build is
// `preferred` because Rosetta 2 runs it on Apple silicon too -- an asymmetry
// worth exploiting, since the wrong guess in that direction still works and
// the reverse does not. `appleSilicon` upgrades to the native build only when
// the browser will actually say so.
export const heroDownloads: HeroDownload[] = [
  {
    os: 'windows',
    name: 'Windows',
    meta: 'AMD64',
    ext: 'msi',
    href: `${RELEASE_DOWNLOAD}/netscli-gui-windows-x86_64.msi`,
    cue: 'Windows · .msi installer',
    preferred: true,
  },
  {
    os: 'macos',
    name: 'macOS',
    meta: 'Apple silicon',
    ext: 'dmg',
    href: `${RELEASE_DOWNLOAD}/netscli-gui-macos-aarch64.dmg`,
    cue: 'macOS · Apple silicon .dmg',
    appleSilicon: true,
  },
  {
    os: 'macos',
    name: 'macOS',
    meta: 'Intel x86_64',
    ext: 'dmg',
    href: `${RELEASE_DOWNLOAD}/netscli-gui-macos-x86_64.dmg`,
    cue: 'macOS · Intel .dmg',
    preferred: true,
  },
  {
    os: 'linux',
    name: 'Linux',
    meta: 'x86_64 portable',
    ext: 'AppImage',
    href: `${RELEASE_DOWNLOAD}/netscli-gui-linux-x86_64.AppImage`,
    cue: 'Linux · .AppImage',
    preferred: true,
  },
  {
    os: 'linux',
    name: 'Debian / Ubuntu',
    meta: 'AMD64',
    ext: 'deb',
    href: `${RELEASE_DOWNLOAD}/netscli-gui-linux-x86_64.deb`,
    cue: 'Linux · .deb package',
  },
];

// What the hero's two command rows say once the visitor's platform is known.
// `quickInstall` and `quickInstallAlt` above are the server-rendered defaults
// for the same two rows; these replace them per platform.
//
// Keyed by ROUTE, not by rank: `packageManager` is the package-manager line
// and `script` the one-liner, and the hero puts each in the row that fits it
// -- the wide row beside the button takes the script, the narrower row below
// takes the package manager. They were once named `primary`/`secondary`,
// which described rank rather than route, and Linux had the two the other way
// round, so the wide row got a 90-character URL on one platform and a short
// package command on the others.
export const heroCommands: HeroCommands = {
  windows: {
    // Moniker, matching the hero's server-rendered default. `Moniker:
    // netscli` is published in the winget catalog alongside the canonical
    // `fstubner.netscli`, so both resolve.
    packageManager: 'winget install netscli',
    script: INSTALL_PS1_COMMAND,
  },
  macos: {
    packageManager: 'brew tap fstubner/tap && brew install netscli',
    script: INSTALL_SH_COMMAND,
  },
  linux: {
    packageManager: 'yay -S netscli-bin',
    script: INSTALL_SH_COMMAND,
  },
};
