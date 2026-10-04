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
- **The installer URL is versioned, never changes, and does not redirect.**
  The Store refuses a URL that redirects, and every GitHub release download
  does (302 to a signed, expiring address). So the site serves the last three
  releases' MSIs itself, at `https://netscli.com/download/<tag>/netscli-gui-windows-x86_64.msi`,
  each checked against its release's published SHA-256 when the site is built
  (`scripts/release/stage-store-downloads.sh`, run by `pages.yml`).
- **Silent install.** For MSI packages the Store runs the installer with `/qn`
  itself, so there are no installer parameters to enter. The MSI installs per
  machine, so Windows shows a UAC prompt, which the Store allows.
- **Updates.** The Store does not update MSI apps. The in-app updater does,
  and 0.3.4 is the first version that has it.
- **Privacy policy.** https://netscli.com/privacy/

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
| Packages | Package URL `https://netscli.com/download/v0.3.4/netscli-gui-windows-x86_64.msi`. Architecture **x64**. Language **English (en-us)**. App type **MSI**. |
| Store listing | The text and images below |
| Submission options | Paste the certification notes below |

### 4. Submit

Accept the agreements and submit. Certification usually takes a few business
days. Each later release needs a new submission with that release's MSI URL.
The site only picks up a new release's MSI when it is next deployed, so after
publishing a release run the Deploy GitHub Pages workflow (or merge any site
change) before giving the Store the new URL.
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

Upload these five from `packaging/msstore/`, in order, with the captions
below. Each is 2732 x 1536 PNG, the app's 1366 x 768 layout drawn at twice the
pixels, inside the Store's 1366 x 768 minimum and 3840 x 2160 maximum.

| File | Caption |
| --- | --- |
| `screenshot-1-discover.png` | Every device on your network, with names and makers |
| `screenshot-2-scan.png` | Open ports, and the software and version behind them |
| `screenshot-3-inspect.png` | A best guess at the operating system, with the clues behind it |
| `screenshot-4-dns.png` | DNS records for any domain |
| `screenshot-5-mdns.png` | Printers, speakers and hubs that announce themselves |

They show the app's screenshot mode, which fills each tool with a fixed home
network in the documentation address range (192.0.2.0/24), so no real
address or device appears. To retake them after a UI change, run the desktop
app's frontend (`npm run dev` in `apps/netscli-gui`) and capture each tool
with headless Chrome:

```powershell
foreach ($t in 'discover','scan','inspect','dns','mdns') {
  & 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --hide-scrollbars `
    --force-device-scale-factor=2 --window-size=1366,768 --virtual-time-budget=4000 `
    --screenshot="$PWD\$t.png" "http://localhost:1420/?demo=screenshot&tab=$t"
}
```

### Store logos

Both are in `packaging/msstore/`, rendered by the app icon's own generator
(`apps/netscli-gui/src-tauri/icons/create_icon.py`), so they match the
installed app.

- **1:1 box art (required)**: `box-art-1080.png`, 1080 x 1080.
- **1:1 app tile icon (recommended)**: `tile-300.png`, 300 x 300.
- **2:3 poster art**: optional for apps, skipped.

To render them again:

```bash
cd apps/netscli-gui/src-tauri/icons
uv run --with pillow python -c "import create_icon as c; open('box-art-1080.png','wb').write(c.render_png(1080)); open('tile-300.png','wb').write(c.render_png(300))"
```
