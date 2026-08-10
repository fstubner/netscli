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

## Packet capture requirements

Normal scan, discovery, DNS, ARP, ping, trace, and interface workflows do not require packet-capture libraries.

Packet capture is the exception:

- Windows requires Npcap at runtime.
- Linux requires libpcap and appropriate capture permissions.
- macOS requires libpcap availability and may require capture permissions.

If a build does not include packet capture support, the desktop app hides Packet Capture and the CLI omits that command path. If support is included but the runtime library is missing, only packet capture is unavailable.
