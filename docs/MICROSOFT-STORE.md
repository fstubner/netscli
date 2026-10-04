# Microsoft Store listing

The desktop app goes into the Microsoft Store as an MSI, through Partner
Center's MSI/EXE route (issue #466). This file has the steps in order and the
listing text, ready to paste. Only the desktop app is listed. The CLI is
already on winget, Scoop and npm.

## Ready on our side

Checked on 2026-10-04 against the published v0.3.4 installer.

- **Every program inside the installer is signed.** An administrative extract
  of `netscli-gui-windows-x86_64.msi` gives one executable, `netscli-gui.exe`,
  and `Get-AuthenticodeSignature` reports **Valid** for it and for the MSI,
  signed by the Certum certificate. The Store requires this for the installer
  and every program inside it, and v0.3.3 failed it.
- **The installer URL is versioned and never changes.** GitHub Release asset
  URLs include the tag.
- **Silent install.** For MSI packages the Store runs the installer with `/qn`
  itself, so there are no installer parameters to enter. The MSI installs per
  machine, so Windows shows a UAC prompt, which the Store allows.
- **Updates.** The Store does not update MSI apps. The in-app updater does,
  and 0.3.4 is the first version that has it.
- **Privacy policy.** https://netscli.com/docs/privacy/

## Known risk

The installer embeds the WebView2 bootstrapper, which downloads the WebView2
runtime during setup if the machine does not have it. The Store requires an
installer that downloads nothing while it runs. WebView2 ships with every
current Windows 10 and 11, so the bootstrapper does nothing in practice, but a
reviewer could still object. If they do, the fix is a Store build with
`webviewInstallMode` set to `offlineInstaller`, which adds about 130 MB.

## Steps

### 1. Create the developer account (about 15 minutes, free)

1. Go to https://storedeveloper.microsoft.com. This is the only entry point
   with no registration fee. Starting from Partner Center directly shows the
   old flow.
2. Select **Get started for free**, then **Individual developer**. An
   individual account publishes under your own name. It cannot be converted
   to a company account later.
3. Sign in with a personal Microsoft account, or create one. Work accounts are
   not accepted for individual accounts.
4. Verify your identity with a government ID and a selfie, taken on your
   phone in good light with the original document.
5. Check the profile details it fills in, then select **Go to Partner Center
   dashboard**. If the Apps and Games tile is not there yet, wait about five
   minutes and refresh, or go to https://aka.ms/submitwindowsapp.

### 2. Reserve the name

In Apps and Games, select **New product**, then **MSI or EXE app**, and
reserve **NetsCLI**.

### 3. Fill in the submission

| Section | What to enter |
| --- | --- |
| Pricing and availability | Free, all markets |
| Properties | Category **Developer tools**. Privacy policy URL from above. Website https://netscli.com. Support contact https://github.com/fstubner/netscli/issues |
| Age ratings | Complete the IARC questionnaire. No violence, no user content, no communication between users, no purchases. It reads local network information, which the privacy policy covers. |
| Packages | Package URL `https://github.com/fstubner/netscli/releases/download/v0.3.4/netscli-gui-windows-x86_64.msi`. Architecture **x64**. Language **English (en-us)**. App type **MSI**. |
| Store listing | The text and images below |
| Submission options | Paste the certification notes below |

### 4. Submit

Accept the agreements and submit. Certification usually takes a few business
days. Each later release needs a new submission with that release's MSI URL.
That can be automated with the Store submission API once the first one has
passed.

## Listing text

### Short description

> Network scanner for Windows. Find devices on your network, scan TCP and UDP ports, look up DNS records and inspect hosts.

### Description

> NetsCLI is a network scanner for people who look after a home or office network. Point it at your network and it lists every device it can find, with the name, maker and address of each. Pick a device and it shows which ports are open, what software answers on them, and its best guess at the operating system, with the clues behind that guess.
>
> It also looks up DNS records, lists the services devices announce on the local network (printers, speakers, smart home hubs), reads your computer's network interfaces and neighbour table, and traces the route to a host.
>
> Everything runs on your computer. There are no accounts and no telemetry, and nothing you scan is sent anywhere.
>
> The same scanner is available as a command line tool, a terminal UI, and an MCP server that AI assistants can use. The desktop app is the easiest way in. NetsCLI is free and open source under the MIT license, at https://github.com/fstubner/netscli.

### Features (up to 20)

1. Find the devices on your network, with names, makers and addresses
2. Scan TCP ports and common UDP services
3. See the software and version a service reports
4. OS hint for a host, with the evidence behind it
5. DNS lookups for every common record type
6. Discover devices that announce themselves on the local network
7. Trace the route to a host
8. Export results to CSV
9. Updates itself from inside the app
10. No accounts, no telemetry

### Keywords (up to 7)

network scanner, port scanner, IP scanner, LAN, DNS lookup, network discovery, nmap alternative

### Certification notes

> NetsCLI is a network diagnostics tool. When the user starts a scan, it sends ordinary network traffic (ping, TCP connections, UDP probes and DNS queries) to the addresses the user chose, by default the computer's own local network. It does not run in the background, needs no administrator rights to scan, and sends no data to the developer. The only connection it makes on its own is a check for new releases against GitHub's API, which the user can turn off in Preferences. To test, open the app and run Discover, which scans the local network, then Port Scan against 127.0.0.1.

### Screenshots

PNG, 1366 x 768 or larger, up to 10, with a caption of up to 200 characters
each. The four on the website (`site/public/assets/gui-*.png`, 2000 x 1125)
are big enough but should not be used as they are. They predate 0.3.4, so
there is no Version column or OS hint, and the port scan shows a single test
server answering "netscli-e2e". Retake them from 0.3.4 against a realistic
network, one per row below.

| Screen | Caption |
| --- | --- |
| Discover, a full list of devices | Every device on your network, with names and makers |
| Port Scan with versions showing | Open ports, and the software and version behind them |
| Inspect with the OS hint open | A best guess at the operating system, with the clues behind it |
| DNS lookup | DNS records for any domain |
| mDNS | Printers, speakers and hubs that announce themselves |

### Store logos

- **1:1 box art, 1080 x 1080 (required).** Render it from the app icon's
  generator, which draws the same mark as the installed app:
  ```bash
  cd apps/netscli-gui/src-tauri/icons
  uv run --with pillow python -c "import create_icon as c; open('box-art-1080.png','wb').write(c.render_png(1080))"
  ```
- **1:1 app tile icon, 300 x 300 (recommended).** The same command with `300`.
- **2:3 poster art (optional for apps).** Skip it for the first submission.
