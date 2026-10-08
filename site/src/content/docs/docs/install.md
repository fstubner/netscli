---
title: Installation
description: Install NetsCLI through package managers, direct downloads, scripts, npm, or Cargo.
head:
  - tag: title
    content: Install NetsCLI on Windows, macOS and Linux | NetsCLI docs
---

NetsCLI publishes command-line binaries and desktop installers through GitHub Releases. The CLI/TUI binary is named `netscli`. The desktop app is distributed as NetsCLI Desktop.

## Recommended installs

| Platform | Recommended path | Installs |
| --- | --- | --- |
| Windows | `winget install netscli` | CLI and TUI |
| Windows | `winget install netscli-gui` | Desktop app |
| macOS | Homebrew or install script | CLI and TUI |
| macOS | `brew install --cask fstubner/tap/netscli-gui` | Desktop app |
| Linux | Install script, Homebrew, AUR, or release download | CLI and TUI |
| Linux | `.deb`, AppImage, or `yay -S netscli-gui-bin` | Desktop app |
| Rust users | `cargo install netscli` | CLI and TUI from crates.io |
| Node users | `npx netscli` | CLI and TUI from npm, no install step |

## Windows

Use winget for the hash-verified install path:

```powershell
winget install netscli
```

The desktop app is distributed separately:

```powershell
winget install netscli-gui
```

It is also in the [Microsoft Store](https://apps.microsoft.com/detail/xpfg556rr6b76z),
which installs the same signed `.msi`.

If a short name ever matches more than one package, use the full
identifiers, `fstubner.netscli` and `fstubner.netscli.gui`.

Scoop is also supported, for both the CLI and the desktop app:

```powershell
scoop bucket add fstubner https://github.com/fstubner/scoop-bucket
scoop install netscli
scoop install netscli-gui
```

Or the PowerShell install script, which picks the right download for your machine:

```powershell
iwr -useb https://netscli.com/install.ps1 | iex
```

Direct Windows downloads are on the
[releases page](https://github.com/fstubner/netscli/releases/latest). From
0.3.3 on, the `.exe` downloads and the `.msi` installer are signed, so Windows
names the publisher instead of showing an unknown one. From 0.3.4 the desktop
app inside the installer is signed too. While the certificate is new,
SmartScreen may still show a warning the first time you run one.

## macOS

Use Homebrew when available:

```bash
brew tap fstubner/tap && brew install netscli
```

Or use the install script:

```bash
curl -fsSL https://netscli.com/install.sh | bash
```

For the desktop app, use the Homebrew cask:

```bash
brew install --cask fstubner/tap/netscli-gui
```

Or download the `.dmg` for Apple Silicon or Intel from the
[releases page](https://github.com/fstubner/netscli/releases/latest).

The desktop app is not notarized by Apple, so macOS blocks its first launch,
whichever way you installed it. Open it once, then go to **System Settings →
Privacy & Security** and click **Open Anyway**. You only need to do this once.
(Right-click → Open no longer does this on macOS 15 and later.)

## Linux

Use the install script:

```bash
curl -fsSL https://netscli.com/install.sh | bash
```

Install with Homebrew on Linux when you use Linuxbrew:

```bash
brew tap fstubner/tap && brew install netscli
```

On Arch-based systems with an AUR helper:

```bash
yay -S netscli-bin
```

For the desktop app, download the `.deb` (Debian, Ubuntu and derivatives) or
the AppImage (any distribution) from the
[releases page](https://github.com/fstubner/netscli/releases/latest):

```bash
sudo apt install ./netscli-gui-linux-x86_64.deb
```

```bash
chmod +x netscli-gui-linux-x86_64.AppImage
./netscli-gui-linux-x86_64.AppImage
```

On Arch-based systems:

```bash
yay -S netscli-gui-bin
```

### If the desktop window opens black or blank

On some Linux machines the desktop app's window opens but stays black or
blank. It is a graphics driver problem, and has been seen on virtual machines.

**Close the window and open the app again.** The app notices the blank launch
and switches to a safer drawing mode the next time, so the second launch
usually works.

If it is still blank, start it once with:

```bash
netscli-gui --disable-gpu-compositing
```

The app remembers this, so later launches from the desktop icon keep working.
To go back to the default:

```bash
netscli-gui --gpu-compositing
```

Windows and macOS are not affected, and the two options do nothing there.

## Cargo

If Rust is installed:

```bash
cargo install netscli
```

Cargo installs the CLI/TUI binary. It does not install the desktop app.

## npm

If Node 18 or newer is installed, you can run NetsCLI without installing
anything:

```bash
npx netscli --help
```

Or install it globally:

```bash
npm install -g netscli
```

npm downloads only the prebuilt binary for your platform. Published targets
are Linux x64 and arm64, macOS x64 and Apple Silicon, and Windows x64. The
Linux arm64 binary needs glibc 2.39 or newer.

What the npm build leaves out:

- **Packet capture.** It needs libpcap or Npcap on the machine, which npm
  cannot arrange. Use a package from the sections above if you need it.
- **The desktop app.** npm installs the CLI and TUI only.

If you mainly want the MCP server, see [MCP server](/docs/mcp/). The npm package is one of three ways to connect it.

## Updating

Use the same package manager you installed with.

Update the CLI and TUI on Windows:

```powershell
winget upgrade fstubner.netscli
```

Update the desktop app on Windows:

```powershell
winget upgrade fstubner.netscli.gui
```

Update a Homebrew install:

```bash
brew upgrade netscli
```

The desktop app can also update itself from 0.3.4 on. It checks for a new release when it opens and offers to install it. See [Updates](/docs/desktop/#updates) for which installs can do this.

Update a global npm install:

```bash
npm update -g netscli
```

`npx netscli` may reuse a copy it has cached. To be sure you get the newest
release, run `npx netscli@latest`.

For a direct download, get the [latest GitHub release](https://github.com/fstubner/netscli/releases/latest) and replace the previous install with the matching package for your platform.

## Verifying a download

Every CLI and desktop release asset is checksummed and signed, and both can be
checked before you run anything.

### Checksums

Each asset ships a `.sha256` sidecar next to it on the release page. The
install scripts fetch and check it for you, and refuse to install if it is
missing. To check a manual download yourself:

```bash
# Linux / macOS
curl -fsSLO https://github.com/fstubner/netscli/releases/latest/download/netscli-linux-x86_64
curl -fsSLO https://github.com/fstubner/netscli/releases/latest/download/netscli-linux-x86_64.sha256
sha256sum -c netscli-linux-x86_64.sha256
```

```powershell
# Windows
(Get-FileHash -Algorithm SHA256 .\netscli-windows-x86_64.exe).Hash.ToLower()
# compare against the contents of netscli-windows-x86_64.exe.sha256
```

### Signatures

A checksum only proves the file matches its own sidecar, and both come from
the same place. The signature is what ties the asset to the workflow run that
built it.

Every CLI and desktop asset is signed with [Sigstore
cosign](https://docs.sigstore.dev/cosign/signing/overview/) by the release workflow,
and the signature is tied to the exact run that built it. Each of those assets ships a
`.sig` and a `.pem` beside it:

```bash
cosign verify-blob \
  --signature netscli-linux-x86_64.sig \
  --certificate netscli-linux-x86_64.pem \
  --certificate-identity-regexp '^https://github\.com/fstubner/netscli/\.github/workflows/release\.yml@refs/(heads/main|tags/v[0-9.]+)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  netscli-linux-x86_64
```

Substitute the asset name you downloaded. The same command works for the desktop `.msi`, `.dmg`, `.deb` and `.AppImage`. The identity is pinned to the release workflow on `main` (or a release tag, for releases before 0.3.1), so a signature made by that file on any other branch does not pass. The `.mcpb` bundles are signed by the publishing workflow instead, so for those replace `release\.yml` with `publish\.yml`. It needs the [cosign
CLI](https://docs.sigstore.dev/cosign/system_config/installation/). A pass
confirms the asset was built and signed by this repository's release workflow
and has not been altered since.

This is separate from the code signing Windows and macOS check. The Windows
downloads carry a Windows signature from 0.3.3 on, and the macOS app is not
notarized. See the Windows and macOS sections above for what your system will
say on first run.

## Packet capture

**None of the installs above include packet capture.** The desktop installers, the standard CLI downloads, and `cargo install netscli` are all built without it, so none of them needs libpcap or Npcap. The rest of this section is how to get a build that has it.

Normal scan, discovery, DNS, ARP, ping, trace, and interface workflows are unaffected and need none of this.

If you do want packet capture, you need **both** a build that has the feature compiled in **and** the system capture library.

### CLI with packet capture

The install script does both at once. It selects the `-pcap` build *and* installs the system library.

```bash
curl -fsSL https://netscli.com/install.sh | NETSCLI_PCAP=1 bash
```

```powershell
$env:NETSCLI_PCAP=1; iwr -useb https://netscli.com/install.ps1 | iex
```

On Windows this runs the Npcap installer, which needs administrator rights. Add `NETSCLI_SKIP_NPCAP=1` (or `NETSCLI_SKIP_LIBPCAP=1` on Unix) if you manage the capture library yourself.

Alternatively, download the `-pcap` asset directly from the [latest release](https://github.com/fstubner/netscli/releases/latest) (`netscli-linux-x86_64-pcap`, `netscli-macos-aarch64-pcap`, `netscli-windows-x86_64-pcap.exe`, and so on) and install the capture library separately. There is no `-pcap` musl build.

Or build it yourself, which needs the development headers (`libpcap-dev` on Debian/Ubuntu, or the [Npcap SDK](https://npcap.com/#download) on Windows):

```bash
cargo install netscli --features pcap
```

### Desktop app with packet capture

There is **no published desktop installer with packet capture**. The Packet Capture tool appears in the app but shows setup guidance instead of running. To get a capture-capable desktop build you have to build from source:

```bash
cd apps/netscli-gui
npm install
npm run tauri build -- --features pcap
```

### System requirements

| Platform | Requirement |
| --- | --- |
| Windows | Npcap installed. `wpcap.dll` lives in `C:\Windows\System32\Npcap\`, which is not on `PATH` by default. Add it, or let `NETSCLI_PCAP=1` do it. |
| Linux | libpcap installed, plus capture permissions (`CAP_NET_RAW` or root). |
| macOS | libpcap available, plus capture permissions where required. |

### Checking what you have

`netscli doctor` works on **every** build and reports whether packet capture is compiled in and whether the runtime library is present:

```bash
netscli doctor
```

Note that `netscli pcap --check` only exists on builds that were compiled with the feature. On a standard build the subcommand is absent entirely, and you will get an "unrecognized subcommand" error rather than a useful message. Use `doctor` to find out which build you have.
