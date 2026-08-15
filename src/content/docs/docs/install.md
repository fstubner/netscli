---
title: Installation
description: Install NetsCLI through package managers, direct release artifacts, scripts, or Cargo.
---

NetsCLI publishes command-line binaries and desktop installers through GitHub Releases. The CLI/TUI binary is named `netscli`. The desktop app is distributed as NetsCLI Desktop.

## Recommended installs

| Platform | Recommended path | Installs |
| --- | --- | --- |
| Windows | `winget install fstubner.netscli` | CLI and TUI |
| Windows | `winget install fstubner.netscli.gui` | Desktop app |
| macOS | Homebrew or install script | CLI and TUI |
| Linux | Install script, Homebrew, AUR, or release artifact | CLI and TUI |
| Rust users | `cargo install netscli` | CLI and TUI from crates.io |

## Windows

Use winget for the hash-verified install path:

```powershell
winget install fstubner.netscli
```

The desktop app is distributed separately:

```powershell
winget install fstubner.netscli.gui
```

Scoop is also supported, for both the CLI and the desktop app:

```powershell
scoop bucket add fstubner https://github.com/fstubner/scoop-bucket
scoop install netscli
scoop install netscli-gui
```

Or the PowerShell install script, which picks the right asset for your machine:

```powershell
iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex
```

Direct Windows installers are attached to GitHub Releases. They are not Authenticode-signed yet, so Windows may show a publisher warning when installing outside winget. The winget manifests verify release asset hashes.

## macOS

Use Homebrew when available:

```bash
brew tap fstubner/tap && brew install netscli
```

Or use the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash
```

Desktop `.dmg` artifacts are attached to GitHub Releases where the release workflow publishes them. macOS may require the usual first-run approval for unsigned or independently distributed apps.

## Linux

Use the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash
```

Install with Homebrew on Linux when you use Linuxbrew:

```bash
brew tap fstubner/tap && brew install netscli
```

On Arch-based systems with an AUR helper:

```bash
yay -S netscli-bin
```

Release artifacts may include Linux CLI binaries and desktop packages such as `.deb` or `.AppImage`, depending on the release.

## Cargo

If Rust is installed:

```bash
cargo install netscli
```

Cargo installs the CLI/TUI binary. It does not install the desktop app.

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

For direct release artifacts, download the [latest GitHub release](https://github.com/fstubner/netscli/releases/latest) and replace the previous install with the matching package for your platform.

## Packet capture

**No install on this page includes packet capture.** It is a compile-time feature, and every published build — the desktop installers, the standard CLI release assets, and `cargo install netscli` — is built without it. That keeps the default install free of any libpcap/Npcap dependency and avoids redistributing Npcap.

Normal scan, discovery, DNS, ARP, ping, trace, and interface workflows are unaffected and need none of this.

If you do want packet capture, you need **both** a build that has the feature compiled in **and** the system capture library.

### CLI with packet capture

The install script does both at once — it selects the `-pcap` build *and* installs the system library:

```bash
curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | NETSCLI_PCAP=1 bash
```

```powershell
$env:NETSCLI_PCAP=1; iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex
```

On Windows this runs the Npcap installer, which needs administrator rights. Add `NETSCLI_SKIP_NPCAP=1` (or `NETSCLI_SKIP_LIBPCAP=1` on Unix) if you manage the capture library yourself.

Alternatively, download the `-pcap` asset directly from the [latest release](https://github.com/fstubner/netscli/releases/latest) — `netscli-linux-x86_64-pcap`, `netscli-macos-aarch64-pcap`, `netscli-windows-x86_64-pcap.exe`, and so on — and install the capture library separately. There is no `-pcap` musl build.

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
| Windows | Npcap installed. `wpcap.dll` lives in `C:\Windows\System32\Npcap\`, which is not on `PATH` by default — add it, or let `NETSCLI_PCAP=1` do it. |
| Linux | libpcap installed, plus capture permissions (`CAP_NET_RAW` or root). |
| macOS | libpcap available, plus capture permissions where required. |

### Checking what you have

`netscli doctor` works on **every** build and reports whether packet capture is compiled in and whether the runtime library is present:

```bash
netscli doctor
```

Note that `netscli pcap --check` only exists on builds that were compiled with the feature — on a standard build the subcommand is absent entirely and you will get an "unrecognized subcommand" error rather than a useful message. Use `doctor` to find out which build you have.
