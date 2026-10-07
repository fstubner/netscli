# Changelog

All notable changes to netscli are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Workspace crates (`netscli`, `netscli-core`, `netscli-mcp`) and the
desktop app are released together under one version number. Note that
they do not *inherit* it. Each crate sets its own, and the GUI carries
further copies in `package.json` and `tauri.conf.json`. See
`docs/PUBLISHING.md` for the full list of files a bump has to touch.

A version heading gets its date and its link in a commit of their own, once
the version's tag is pushed. The date is the day the release is meant to go
out, and it moves if the release slips. Neither says the release is
published. 0.3.1 was dated here when its notes were drafted, before it was
even tagged, and the website showed it as released for four days. So the
website now asks GitHub which releases are published, and labels any other
version "Not yet released" whatever its heading says. An in-flight version
keeps a bare heading and collects entries.

## [0.3.5] - 2026-10-06

### Added

- **The terminal UI honours `NO_COLOR`, and the CLI honours `TERM=dumb` and
  `CLICOLOR_FORCE`.** The CLI's tables already went plain for `NO_COLOR` and
  for output that is not a terminal. The terminal UI ignored `NO_COLOR` and
  always drew in 24-bit colour. It now draws without colour when `NO_COLOR` is
  set, keeping bold, and shows the selected row in `/config` reversed instead
  of shaded. The CLI also stops colouring for `TERM=dumb`, and
  `CLICOLOR_FORCE=1` keeps colour when the output is piped, for `less -R` or a
  CI log. `netscli --help` now lists these, and `NETSCLI_HISTORY`, at the end.

- **The MCP server reports progress and can be cancelled.** Discover, port
  scans and sweeps send progress notifications to clients that ask for them,
  so a long sweep no longer looks stuck. A client that cancels a call now
  stops the scan, instead of it running to the end and holding one of the
  server's sixteen request slots.

### Changed

- **History is off unless you set `NETSCLI_HISTORY=1`.** Every `discover`,
  `scan`, `inspect`, `sweep`, `dns`, `reverse` and `pcap` run, from the command
  line and the terminal UI, kept its whole result in `~/.netscli/netscli.db`
  for good, and nothing reads it back. Every other command created the file
  too, just by starting, `completions` and `man` included. NetsCLI now opens
  and creates nothing until the variable is set. With it set, history works as
  before, and on Linux and macOS the folder and file it creates are readable by
  you alone. A database an earlier version made is left where it is, and
  deleting it is up to you. Where no home folder can be found, the database and
  the terminal UI's default export folder no longer fall back to a `.netscli`
  folder in the current directory. They say there is no home instead.

- **Exit codes follow what happened.** `0` means the command worked, `1` that
  it ran and failed, and `2` that the command line was wrong. Until now `ping`
  exited 0 when nothing answered, `trace` exited 0 when `tracert` or
  `traceroute` had failed, `doctor` exited 0 with a dependency missing, and
  asking for two output formats exited 1 like a failed scan. `ping` and `trace`
  now exit 1 in those cases, `doctor` exits 1 when libpcap is missing from a
  build that has packet capture, and two output formats, or `ping -c 0`, exit 2
  before anything runs. `ping -c 0` used to print `loss=0.0%` for a ping that
  sent nothing. A `dns --record ALL` where only some record types have records
  still exits 0. A script that ignored the exit code of `ping` or `trace` will
  start to see 1, and the CLI page lists every code.

- **`netscli mcp-service --install` no longer installs a systemd unit.** The
  unit could not work. `netscli serve` speaks MCP over stdin and stdout and
  stops when its input closes, and systemd gives a service no input, so the
  server exited at once and `Restart=always` started it again every five
  seconds. An MCP client starts the server itself. The command now says so,
  points to the MCP setup guide, and exits 1. It also wrote the unit on Windows
  and macOS, where nothing could read it. `--uninstall` and `--status` stay, on
  every system, to find and remove a unit an earlier version left behind.
  Running `mcp-service` with no flag is now a usage error instead of a hint and
  exit 0.

- **The terminal UI's `/discover` looks up hostnames only when you add
  `--resolve`.** It always looked them up, with no way to turn that off, where
  the CLI, the desktop app, the MCP server and `/sweep` all leave it out unless
  asked. Its summary line says which it did. The help for `/sweep` listed
  `--no-resolve`, which does nothing, and not `--resolve`, which does. It now
  lists `--resolve`.

- **`netscli pcap` does not replace an existing capture file unless you add
  `--force`.** It writes `capture.pcap` in the current folder by default and
  used to overwrite whatever was there, so a second capture quietly destroyed
  the first. A script that captures to the same name every time now needs
  `--force`.

- **Enter on half a command name in the terminal UI finishes the name instead
  of running it.** `/e` then Enter ran `/export`, the first suggestion, which
  writes a file, when the user was heading for `/exit`, and `/d` started a
  discovery of the default subnet. The name is now completed, as `Tab` does,
  and a second Enter runs it.

- **The desktop app stays responsive with large results.** It drew every
  row of a result and redrew all of them on every keypress or scroll, so a
  full 4,096-port scan took about a tenth of a second per arrow key, and a
  20,000-row result such as a long packet capture over half a second. It now
  draws only the rows on screen, so 4,096 rows respond as fast as 100, and
  20,000 in about a twentieth of a second. Progress updates
  from a running scan are also sent ten times a second instead of once per
  port.

- **Windows lists the desktop app's publisher as Felix Stubner.** Installed
  apps showed "netscli", a default taken from the app's internal identifier,
  while the code signature, winget and the Microsoft Store listing all say
  Felix Stubner. Upgrading from an earlier version leaves one entry, under the
  new name.

- **CSV files saved by the desktop app start with a UTF-8 byte-order mark.**
  The app wrote plain UTF-8, and Excel on Windows reads a CSV that lacks the
  mark in its older code page, so a device called "Felix’s iPhone" would show
  as "Felixâ€™s iPhone". Both CSV exports now begin with the mark, which is how
  Excel is told a file is UTF-8. The command line's CSV is meant for pipes and
  has none, and JSON exports are unchanged. A script that reads these files as
  plain UTF-8 will see the mark in front of the first header and needs
  `utf-8-sig` or the equivalent.

- **The desktop app's content security policy is tighter.** It no longer
  allows images from data or blob URLs or from the asset protocol, and it
  forbids `<base>` elements, form submission and plugin objects. The app uses
  none of them.

- **The update notice says why an install cannot update itself.** Installs
  from Scoop, the AUR or a .deb got the same "Update available" notice as
  everyone else, and its link opens the release page, which invites a manual
  download over a copy the package manager owns. The notice now carries the
  reason, for example "Installed with Scoop, so update it there".

- **The update dialog says the app closes to finish.** On Windows the app
  exits as the installer starts, and nothing said so if the installer was then
  declined or failed. The dialog now says NetsCLI closes to finish and should
  reopen by itself, and to open it again if it does not.

- **The Packet Capture screen says no published installer includes it.** It
  told people to use a PCAP-enabled desktop build, which reads as a download
  that does not exist. It now says the published installers are built without
  packet capture and that it needs a build made from source.

- **A release goes public only once every file is in it.** Each release used
  to go public first and receive its files afterwards, and until they
  arrived the Windows one-line installer and the desktop app's update check
  found nothing to download. For 0.3.4 the Windows files and the update
  manifest arrived 1 h 38 min after the release went public. Releases are now built as
  drafts, checked file by file, and published last.

- **The MCP bundles come with checksums and signatures.** The `.mcpb` files
  were the only release files that carry a program and had no `.sha256`,
  `.sig` or `.pem`. They now have all three, like every other file.

### Fixed

- **Text from the network could reorder or hide itself.** The cleaning that
  makes a hostname, banner or `TXT` value safe to print replaced control
  characters and let everything else through. That included right-to-left
  overrides, which make the text after them display backwards, and zero-width
  characters, which hide text or make two different names look the same. They
  are now replaced with `.` in the CLI's text, CSV and Markdown output, in
  service banners (which the desktop app and the MCP server share), in the
  computer name an SMB host reports, and in the terminal UI. `--json` and
  `--yaml` still carry the text as it was received. A zero-width joiner inside
  an emoji in a name now shows as a dot as well.

- **The terminal UI's `/export md` could write an escape sequence into a
  file.** The screen dropped control characters, but the export wrote the
  stored text as it was, so an mDNS name or a `TXT` value that carried an
  escape sequence ran when someone printed the file to a terminal. The text is
  now cleaned when a command's output is stored, and again when the file is
  written.

- **The `scan` table did not line up in a colour terminal.** Rows were coloured
  first and padded second, and the colour codes count as characters, so a cell
  came out short and the rest of its row slid left. Output sent to a file or a
  pipe was always fine, which is why the tests never saw it.

- **Pasting into the terminal UI on Linux and macOS ran commands.** Typed in
  one key at a time, every pasted line break was a press of Enter, so pasting
  two lines ran the first and went on to the second. A paste now arrives as one
  piece of text with its line breaks turned into spaces. On Windows nothing
  changed, because the terminal library does not support it there.

- **Terminal UI commands ignored words they could not read.** `/ping host abc`
  pinged four times, `/mdns --timeout abc` used 3000, `/discover a b` dropped
  the `b`, and `/arp add 1.2.3.4` with no MAC showed the ARP table. Each now
  answers with a usage error. Worst was `/pcap eth0 --filter tcp port 80`,
  which captured with the filter `tcp`, so every TCP packet, and said nothing.
  `/pcap` now reads quotes, as in `--filter "tcp port 80"`, and says to use
  them when a filter has spaces and none. `/mdns` also takes `--timeout-ms`,
  the CLI's name for it, and `/arp` takes `delete` as well as `del`.

- **`/export --output` in the terminal UI mangled Windows paths and ignored
  `~`.** The path went through a splitter that treats a backslash as an
  escape, so `C:\Users\me\out.md` became `C:Usersmeout.md`, a path relative to
  drive C. And `~/scans/out.md` made a folder named `~`. A backslash is now an
  ordinary character, and a leading `~` is your home folder.

- **A crash in the terminal UI left no message.** The panic message went to the
  alternate screen, which is thrown away when the UI closes, so a crash looked
  like the program closing by itself with exit code 101. The terminal is now
  put back first, so the message is where you can read it.

- **`netscli ... | head` ended in a panic message.** When the reader closed the
  pipe, `scan 127.0.0.1 -p 1-4096 --json | head` printed `failed printing to
  stdout` and a panic, and exited 101. A reader that stops early now just ends
  the output, with exit 0, for the machine-readable formats and the large
  reports (`scan`, `discover`, `sweep`, `inspect` and `pcap --read`).

- **`netscli serve` could keep running for minutes after its client had gone.**
  When the client closes its end, the server drops every request it was
  working on. A ping or capture already running on a blocking thread cannot be
  dropped, and the process waited for it, up to the request's own timeout,
  which the MCP tools allow to be ten minutes. The server now ends the process
  as soon as it has stopped, with every response already written.

- **`netscli scan <name>` did not say which address it scanned.** A name can
  have several, the scan used the first, and nothing in the output said which.
  The text header now reads `example.com (93.184.216.34)`. The JSON is the
  same as before.

- **`doctor` said a standard build had libpcap installed.** Standard builds
  have no packet capture, and `doctor` is how people find that out, but it
  printed a tick. It now reports libpcap as not installed and not compiled in,
  and still exits 0. `setup` no longer offers to install it for such a build,
  where it could not help. And `setup --print`, which is meant to print only,
  no longer writes `~/.netscli/config.json`.

- **Smaller things in what the CLI and the terminal UI print.**
  - `/inspect` showed the round-trip time as `(RTT: Some(3))`, left out a MAC
    address unless its maker was known, and never showed the host name.
  - The terminal UI's status line said `host n/a` in most Linux and macOS
    terminals, because it read `$HOSTNAME`, which zsh does not export. It asks
    the system.
  - In the discover table a long vendor name pushed the hostname column out of
    line, a name with an accent was measured in bytes, and a single host was
    "1 hosts". `sweep` had the same plural.
  - `mdns --timeout-ms 999999` waits 30 seconds and then said nothing was found
    within 999999ms.
  - `--help` said `-j` defaults to 256 when `/config` can change that, gave
    `_http._tcp` as an mDNS type when only `_http._tcp.local.` works, and gave a
    PowerShell completions example that wrote to a file path that is not one.

- **The CLI and terminal UI pages match the program.** The CLI page showed scan
  output from before 0.3.4, and did not list the exit codes, the environment
  variables or the limits that cut a value to fit. The operations page said
  `inspect` with no ports is a host-only check, when it checks 22, 80 and 443.
  The terminal UI page described the real screen with an illustration that
  did not match it, and listed neither the keys nor `/arp add`.

- **Discovery on Windows listed devices that had left the network.** The
  Windows device table keeps an entry for a while after its device goes,
  and discovery reported those entries as devices. On one network that was
  4 of 26, none of which answered anything afterwards. Devices found only in
  the table are now asked again directly, which can add about 2 seconds
  and only when the table holds such entries, and are listed only if they
  answer. Devices that ignore ping still answer, so they are still found.

- **The desktop app's CSV export defuses control characters, as the CLI's
  does.** A banner containing an escape sequence went into the file as it
  was, and a cell such as a tab followed by a number skipped the guard that
  stops a spreadsheet reading it as a formula. Both exports are now tested
  against the same list of cases.

- **The desktop app no longer leaves a program running after looking for
  the CLI.** To offer MCP setup it runs each `netscli` it finds with
  `--version` and gives up after 3 seconds. A program still running at that
  point was left behind. It is now stopped.

- **Console windows no longer open when the desktop app looks up names or
  traces a route on Windows.** Discover and Sweep run `ping -a` for every host
  that answers, Trace Route runs `tracert`, and Settings runs
  `netscli --version` for each candidate it finds. The app has no console of
  its own, so each of those opened one. With Windows Terminal as the default
  terminal that is a window titled with the tool's path, open for as long as
  the tool runs. Called from a program with no console, a name lookup opened
  that window, and with the fix it opened none. The ARP commands already
  started this way.

- **A route trace no longer fails on a Windows set to another language.**
  On a Windows in a language with accented letters, such as German or French,
  `tracert` can print a byte that is not valid UTF-8, and reading its output
  as UTF-8 ended the whole trace with "trace stdout read failed", hops already
  printed included. The output is now decoded leniently, so the odd character
  shows as a replacement mark and the trace completes.

- **A trace refuses a target that the trace tool would read as an option.**
  The target goes to `tracert`, `traceroute` or `tracepath` as a plain
  argument, so `netscli trace -- -d` handed the tool a flag. A target that is
  empty or starts with `-` or `/` now gets an error before anything runs. A
  host name or an address never starts with either, and Windows' `tracert`
  reads a leading `/` as an option too.

- **File dialogs in the desktop app no longer freeze the window.** Open
  Result Bundle, Choose Folder and the Save dialog for exports waited for the
  dialog on the thread that draws the window, which the dialog library says
  not to do. On Windows, Open Result Bundle left the window unable to answer
  anything for as long as its dialog was open, and Windows marked it as not
  responding after about five seconds. The others wait the same way. They now
  wait off that thread, and the window keeps answering.

- **A stalled update download no longer traps the update dialog.** The dialog
  cannot be closed while an update downloads, and nothing limited how long a
  download could take, so one that stalled kept the dialog open until the app
  was quit. The update check now gives up after 30 seconds and the download
  after 10 minutes, and the dialog then shows its message and a link to the
  release page.

- **The desktop app announces failed runs and progress to screen readers.** A
  failed run's message and the progress bar were silent at the default
  settings, because the only live regions were the toasts, which are off by
  default. The error message is now an alert, and a hidden status line says
  when a run starts, at each quarter of the way, and when it finishes with its
  summary or is stopped.

- **Escape no longer stops a scan when it only closes a dialog or menu.**
  Closing the About dialog, the update dialog or a context menu with Escape
  also cancelled the scan running underneath it. Escape now closes what is
  open and leaves the scan alone.

- **A damaged save-settings file no longer stops every export.** One
  unreadable `gui-save-settings.json` made every export and capture fail
  until the file was deleted by hand, and the Settings controls could not
  repair it. It now reads as the defaults, and the next change writes a good
  file over it. The file is written through a temporary one, so an
  interruption cannot leave it half written.

- **A damaged result file no longer crashes the desktop window, and the error
  screen is usable.** A result bundle whose entries lacked fields passed the
  checks and then broke the table while it was drawn, which ended the
  session. Such a file is now refused with a message. The error screen was
  black on near-black on a light theme and gave no way to move or close the
  window. It is now readable and has the window buttons.

- **The command the desktop app copies can no longer carry a shell command
  from a result file.** The command strip, its copy button and the History
  entry are built from the tab's form values, and opening a result file fills
  those from the file. A host such as `1.1.1.1 && calc` was one click from the
  clipboard as a working command. Values with spaces or shell syntax are now
  quoted as one argument, and a value no quoting can make safe (one with a
  `$`, a backtick, a double quote, a `%` or a `!` in it) is left out. A
  capture filter containing a double quote is now left out too, where it was
  escaped before.

- **Smaller accessibility fixes in the desktop app.** Error toasts stay until
  they are dismissed instead of leaving after under two seconds. The tab
  close buttons no longer add a Tab stop each to the tab strip. Workspace
  search tells a screen reader which result is current. The update dialog is
  no longer read out again at every step of a download. The tab spinner stops
  turning when the system asks for reduced motion.

- **MCP clients built on the official SDK can connect.** Every reply the MCP
  server sent carried both a result and an error, one of them empty, which
  the protocol doesn't allow. The official TypeScript SDK drops a reply like
  that, so a client built on it waited for the answer to its first message
  and timed out. Replies now carry one or the other, and CI connects to the
  server with the SDK whenever the code changes.

- **Cancelling an MCP call works when the server is busy.** When a 17th call
  arrived with 16 running, the server stopped reading what the client sent
  until one finished. A cancel, which is how a client frees a slot, went
  unread, and so did the client closing the connection. The server now
  keeps reading. Up to 16 more calls wait for a slot, and any past that are
  refused at once with an error.

- **Cancelling or disconnecting stops an MCP packet capture.** A capture
  ran on after its call was cancelled, timed out or lost its client, for up
  to an hour, and gave its slot back straight away, so cancelling and
  restarting got past the limit of four captures. It now stops, and gives
  the slot back once it has. Background captures stop when the client goes
  too. In a test on Windows, a server whose client left mid-capture exited
  within 0.3 seconds, where before it was still running after 20. A
  `capture_pcap` call with only `maxPackets` could also run for an hour. It
  now stops after the 10 seconds the tool advertises.

- **mDNS discovery no longer leaves its listener running.** A service type
  without its final dot, such as `_http._tcp.local`, or a cancelled MCP
  call left the listener running in the background, its network sockets
  open and any searches it had started still repeating, until the program
  exited. It now always stops.

- **An MCP result too large to send keeps its file path and counts.** A
  result over 1 MiB that wasn't a plain list was replaced by an error, so a
  large packet capture lost its file name, packet count and job status along
  with its packets. Now only its longest list is cut to fit. A background
  capture also reports its file name as soon as it starts.

- **Smaller MCP server fixes.**
  - The server answers `ping`, which clients use to check that a server is
    alive. It answered with an error.
  - It agrees a protocol version it supports, instead of whatever version
    the client asked for.
  - Text from scanned hosts in HTTP headers and mDNS records is cut to 256
    characters, as banners already were.
  - `discover_mdns` takes at most 32 service types, and browses each once.
  - An over-long request line no longer has its tail read as the next
    message.
  - A request that reuses the id of one just answered can always be
    cancelled. A race could leave it impossible to cancel.

- **Smaller scan fixes.**
  - A port behind a firewall that rejects connections with an ICMP message
    reads as filtered, as nmap reports it, instead of as an error.
  - The HTTP probe sends IPv6 targets a valid `Host` header, with the
    address in brackets. The old one was malformed, and a strict server can
    refuse it.
  - A stray `data/oui.json` in the folder netscli ran from no longer
    replaces or empties the vendor list.
  - On a network wider than /16, the default /24 is the one around this
    machine's address on that network. It could come from another interface
    or fall back to 192.168.1.0/24.
  - Windows discovery re-checks at most 64 devices at once. Checked all at
    once, a very long device table could drop devices that were there.
  - The example in the `netscli-core` README compiles.

- **Scans on macOS no longer start at the edge of the open-file limit.**
  Each probe in flight holds a socket, and the default of 256 at once equals
  macOS's default limit on open files, so a busy scan could fail connects for
  lack of a file handle and report them as filtered. NetsCLI now raises its
  own soft limit, up to what the system allows, before a scan starts. Linux
  gets the same, where the default limit is usually 1024.

- **The Windows one-line installer no longer closes PowerShell when it
  fails.** Run as `iwr ... | iex`, the installer's `exit` ended the
  PowerShell session itself, so the window closed and took the error message
  with it. It now stops with an error and leaves the window open.

### Security

- **Four open advisories cleared, all in build tooling.** `source-map-js`
  1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q, high) is in the build dependencies of
  both the desktop app and the website. The other three are the website's
  alone, `http-cache-semantics` 4.2.0 → 4.3.0 (GHSA-ch52-4w7c-c8xp, high),
  `sharp` 0.35.4 → 0.35.5 (GHSA-wq5f-xc86-pv6w, high) and `smol-toml` 1.8.0
  → 1.9.0 (GHSA-r4xh-jqrq-34v2, moderate). None of the four is in anything a
  release ships.

- **MCP packet captures never overwrite a file or follow a symlink.**
  `capture_pcap` wrote `capture.pcap` in the server's working directory,
  often your project, and replaced any file of that name. On Linux and
  macOS, a `capture.pcap` symlink in a repository could send the capture
  through to wherever it pointed, as root if the server ran as root.
  Captures now create a new file and refuse a name that is taken, symlinks
  included, and without `outputFile` each capture gets a new name.

- **DNS lookups no longer go to Cloudflare behind your back.** When your own
  DNS servers could not answer a lookup, including when a name simply had no
  records of the type asked for, NetsCLI asked Cloudflare's public resolver
  (1.1.1.1) the same question. That sent names you looked up to a third
  party, unencrypted and without saying so, and the privacy page said the
  opposite. It affected `dns` and every command that turns a host name into
  an address, in the CLI, the terminal UI, the desktop app and the MCP
  server. Lookups now go only to the DNS servers your computer is set up to
  use. Some home routers refuse record types other than A and AAAA, and `dns`
  now reports that refusal instead of quietly asking someone else.
  `NETSCLI_DNS_FALLBACK` no longer does anything. The privacy page now says
  what 0.3.4 and earlier did.

- **The install scripts check signatures, not only checksums.** A checksum
  from the same release proves a download is intact, not who built it.
  `install.ps1` now refuses a `netscli.exe` whose Authenticode signature is
  not valid or not the project's, and `install.sh` checks the Sigstore
  signature when `cosign` is installed. Both say what they checked.
  `install.sh` also downloads over HTTPS only, redirects included, and a
  download cut short runs nothing.

- **The desktop app installs an update only if its signature names the
  version.** The update manifest itself is not signed, so someone able to
  edit it could offer an older, validly signed installer under a newer
  version number. The app now requires each update's signature to carry the
  version it was made for, and every update file is signed that way.

## [0.3.4] - 2026-10-04

### Added

- **The CLI can write CSV and Markdown tables.** `--csv` and `--md` work on
  every command that returns a list (`discover`, `scan`, `sweep`, `dns`,
  `ping`, `arp`, `interfaces`, `mdns` and `pcap`). The columns are the same
  field names `--json` uses, one row per host, port, record or packet, so a
  result opens straight in a spreadsheet or pastes into an issue without
  going through `jq`. Text a scanned host chose is made safe for each. A
  banner that starts like a spreadsheet formula is defused, the same way the
  desktop app's CSV export already does it, and one containing Markdown or
  HTML is escaped.

- **Port scans show the software and version where a service states them.**
  An SSH server's identification line, a web server's `Server` header, an
  FTP or mail server's greeting and a MySQL or MariaDB server's connection
  greeting usually name the software, often with its version:
  `OpenSSH 9.6p1`, `nginx 1.25.3`, `MariaDB 10.11.6`. Redis, Valkey and
  Memcached say nothing until asked, so each gets the one read-only question
  that returns its version. Scans report this as `product` and `version` in
  the JSON, and in a Version column in the CLI, the terminal UI and the
  desktop app. It's far narrower than nmap's `-sV`. A service that doesn't
  announce itself, and isn't one of those three, gets no version.

- **UDP scanning.** `netscli scan <host> --udp` checks the UDP services most
  networks run (DNS, NTP, NetBIOS, SSDP and mDNS), each sent the request it
  expects, or the ports you give with `-p`. A reply reads as open, with what
  came back (`NTP v4, stratum 2`, a UPnP device's server string, a Windows
  machine's NetBIOS name). A port-unreachable reads as closed, and silence
  reads as `open|filtered`, because UDP can't tell a quiet service from a
  firewall. It needs no administrator rights. The terminal UI takes
  `/scan <host> --udp`, the MCP server's `scan_ports` takes `udp: true`, and
  the desktop app's Port Scan has a TCP/UDP switch.

- **Inspect gives an OS hint.** `netscli inspect` now says what the host
  probably runs, with the clues behind it, such as a Windows machine's exact
  version and build from the start of an SMB connection (no login), the
  distribution an SSH banner names, an `(Ubuntu)` or IIS web server header,
  Windows' RPC and file-sharing ports, an Apple or Raspberry Pi network card,
  and the ping reply's TTL. It also shows the host's MAC address and vendor
  when it's on the same network. It's a hint, not nmap's packet
  fingerprinting, and needs no administrator rights. The same hint is in the
  terminal UI, the desktop app's Inspect details and the MCP server's
  `inspect_host`.

- **The desktop app can update itself.** It already told you when a newer
  release was out and linked to the release page. Now, where it can, the
  notice opens a dialog with the release notes and an **Install and
  restart** button. The update is downloaded, checked against NetsCLI's
  signing key, installed, and the app reopens. Nothing downloads unless you
  click it, and the existing setting still turns the check off entirely.

  Installs that a package manager owns keep the old link, because an update
  from inside the app would fight it. That covers Scoop, the AUR package and
  `.deb` installs. The Homebrew cask now declares `auto_updates`, so
  Homebrew leaves updates to the app.

  This takes effect from the version after this one. An app can only update
  itself if it was built with the updater, so 0.3.4 is the first that can,
  and 0.3.5 is the first update it will install.

### Changed

- **MCP scan replies leave out closed and filtered ports.** `scan_ports` and
  `inspect_host` returned one entry for every port scanned, so a 1,024-port
  scan of a machine with two open ports came to 136,834 bytes of mostly
  "closed". They now return open, `open|filtered` and errored ports only,
  which made the same scan 178 bytes. Pass `include_closed: true` for every
  port. Replies are also sent as compact JSON instead of indented, which
  took a sweep of the local network from 15,399 bytes to 8,746.

- **Defaults now match across the CLI, TUI, desktop app and MCP server.**
  - The desktop app scanned five ports by default (22, 80, 443, 8080 and
    8443) where everything else scans 22, 80 and 443. It now uses the same
    three, for port scans and inspect alike.
  - The MCP server applied the timeout it advertises to every step, so an
    MCP inspect or sweep pinged with 500 ms where the others use 1,000, and
    gave name lookups 500 or 1,000 ms where the others give 1,500. Without a
    `timeout` each step now keeps its usual default.
  - The MCP tool list advertised defaults the server did not use. DNS
    lookups claimed an `A` record and look up every type, discover and
    sweep claimed `192.168.1.0/24` and use your own network, and background
    captures claimed `capture.pcap` and name the file after the job. The
    tool list now says what happens.
  - Ping count tops out at 256 everywhere. The desktop app stopped at 50 or
    64, and the TUI had no limit at all.
  - Desktop inspect ignored the concurrency setting in Preferences. It now
    uses it, like scan, discover and sweep.
  - A desktop packet capture lasts 10 seconds by default, as on the CLI and
    MCP server, instead of 5.

- **Discovery reads the Windows device table directly** instead of running
  `arp -a` and parsing its text. On an idle machine that makes no measurable
  difference (`arp -a` took 65 ms), but it removes a program start from every
  discover and sweep, and under heavy CPU load `arp -a` took about 4 seconds
  on the same machine.

### Fixed

- **Discovery reported the broadcast address as a device.** The network's
  device table on Windows lists `x.x.x.255` with the MAC
  `ff:ff:ff:ff:ff:ff`, and discovery listed it as a host that ignored ping
  (and a sweep then scanned it). The network and broadcast addresses, and broadcast and
  multicast MACs, are no longer reported.
- **Closed ports showed as filtered on Windows.** Windows waits about two
  seconds before reporting a refused connection, and the scan stops waiting
  after half a second, so a port that was plainly closed came back as
  filtered. The scan now reports it as closed straight away. A scan of 1,024
  ports on a LAN machine went from 1,022 filtered to 1,022 closed.
- **The macOS app could be refused as broken on Apple Silicon.** Its only
  signature was the one Apple's linker puts on every arm64 program, which
  claims the app's files are sealed when nothing sealed them. macOS's own
  checks fail it with "code has no resources but signature indicates they
  must be present", a broken app rather than one from an unidentified
  developer, so the Open Anyway route the site describes may never be
  offered. The whole app is now ad-hoc signed, which seals it, and the
  release checks the app inside the finished `.dmg` before shipping it. It is
  still not notarized, so the first launch still goes through Open Anyway in
  System Settings → Privacy & Security.
- **Redis, DNS, NFS, SOCKS and Prometheus ports were probed as if they
  spoke TLS.** The scanner treated any service name ending in "s" as a TLS
  variant, a rule meant for `imaps` and `pop3s`, so these ports got a TLS
  handshake instead of having their greeting read. The TLS services are now
  listed by name.
- **Installing the desktop app with Scoop now adds it to the Start menu.** The
  manifest's shortcut pointed at `NetsCLI.exe`, a file that is in no version of
  the package. Scoop extracts the MSI rather than running it, which leaves the
  app at `PFiles\NetsCLI\netscli-gui.exe`. Scoop reported "Creating shortcut
  ... failed" and finished the install anyway, so the app was installed with no
  way to launch it but finding the folder. The manifest now flattens that
  folder and names the real executable, and the publish job sets both on every
  release.
- **The desktop app itself is signed, not only its installer.** Since 0.3.3 the
  `.msi` has carried an Authenticode signature, but `netscli-gui.exe` inside it
  did not, and that is the file SmartScreen and antivirus look at when the app
  runs. It is now signed during the build, before it is packed into the
  installer, and the release checks the finished MSI's contents before
  shipping it. Measured on the published 0.3.3 installer. The MSI's signature
  is valid, the app inside it is unsigned.

## [0.3.3] - 2026-09-23

### Added

- **Windows executables and the desktop installer are signed.** Both `netscli`
  builds and the `.msi` now carry an Authenticode signature from a Certum
  certificate, timestamped so it keeps verifying after the certificate
  expires. Windows has been showing an unknown-publisher warning on every
  download since the first release, and SmartScreen treats an unsigned
  installer from a low-reputation domain as something to discourage rather
  than merely flag.

  Signing happens in one job, after the builds and before anything is
  uploaded, so a release carries all three signed or none of them. Half a
  signed release would be worse than none. Nothing on the page would say
  which artifacts were which.

- **Two new ways to connect the MCP server, so it no longer has to be a
  hand-written config file.** Until now the only route was installing netscli,
  finding where it landed, and writing the JSON yourself.

  `npx netscli serve` now works: `netscli` is on npm as a small launcher plus
  one prebuilt binary per platform, and npm fetches only the one that matches
  your machine. This is the form every MCP client's documentation already uses.

  There are also `.mcpb` bundles on each release, one per platform. A client
  that supports MCP bundles installs one in a single action. The binary is
  inside, so nothing else is needed. The install prompt carries a switch for
  the local-network default described below, which is the first time that
  choice has been visible to the person making it rather than buried in an
  environment variable.

  Anyone who already has netscli installed should keep pointing their client
  at it. That copy is the version you chose, there is only one of it, and it
  is the only one of the three that can capture packets. Libpcap and Npcap
  cannot be shipped inside an npm package or a bundle.

### Documentation

- **The MCP page now says what the local-network default is and why.** The
  server has refused targets outside your own networks since 0.3.1, and the
  only description of that lived in a source comment, so the first anyone
  heard of it was an error message naming a variable. It is now written down
  next to the reason. This is the one surface where a scan can be requested by
  something a model read rather than by the person at the keyboard.

## [0.3.2] - 2026-09-21

### Added

- **Discover names hosts from mDNS when reverse DNS cannot.** Consumer routers
  do not serve PTR records for their own DHCP clients, and appliances ignore
  LLMNR and NetBIOS, so reverse lookup returned nothing for exactly the devices
  someone opened the app to identify. Those devices announce their names over
  mDNS constantly, and netscli has shipped an mDNS browser all along as a
  separate operation that discover never consulted. It does now, filling only
  the blanks, so nothing that resolves today changes. On one ordinary /24 that
  named 3 more of 26 hosts, taking 21 named to 24. Results carry a
  `hostname_source` of `reverse` or `mdns`, since a name from a device's own
  announcement is a different kind of claim from one in DNS.
- **The desktop app says the MCP server exists.** Someone who only ever opens
  the app had no way to learn that netscli ships an MCP server, let alone
  connect an agent to one. There is now a panel that looks for a netscli binary
  and gives you the client configuration to paste, including what to do when it
  cannot find one. The desktop installers do not carry the CLI.

### Fixed

- **`netscli` with no arguments no longer hangs when there is no terminal.**
  With no subcommand it opens the TUI, which needs a terminal to draw on and
  read from. Without one it did not fail, it blocked forever. Raw mode was
  entered and the runtime then waited on input that could never arrive. So
  `netscli | head`, or `netscli` from a script or a CI job, ran until
  something killed it. It now prints what `--help` prints and exits 0. The TUI
  is unchanged wherever there is a terminal.

  This has been the behaviour since 0.1.0, and it is what has kept the CLI's
  winget package on 0.2.6. Winget's validation runs the executable and waits
  for it, so the 0.3.1 submission has sat since 12 September carrying
  `Validation-Executable-Error` while the desktop app's went through the same
  day.
- **The docs site lost its navigation and its theme switch between 800px and
  1152px wide, and the search button sat stranded beside the wordmark.** The
  header links (Features, Install, FAQ, Docs, Changelog, GitHub) and the
  light/dark control were both hidden across that range, on the understanding
  that the mobile menu carried them from there down. The button that opens
  that menu only appears below 800px, so for 352px of width there was nothing
  to press and no way to reach any of it. The docs sidebar is not a
  substitute. It lists the pages of the docs and carries five of those six
  links nowhere.

  The search button had a second fault behind it. The width at which the links
  hide moved from 900px to 1152px and two rules that depended on that number
  stayed put, so the layout seam ended up on a hidden element, which takes no
  part in the layout. Search fell back to the left with up to 861px of empty
  bar beside it.

  A new check measures where the header's controls sit at seventeen widths.
  Neither fault was visible to the existing accessibility, contrast or
  performance gates, because both are about position rather than markup,
  colour or speed.

- **`netscli-gui-bin` on the AUR installed a desktop app that could not
  start.** The PKGBUILD did not set `options=('!strip')`, and `strip` is in
  makepkg's default options. An AppImage is the AppImage runtime (an
  ordinary static ELF) with a squashfs image appended after everything the
  ELF headers describe, so stripping it rewrote the file from its section
  table and threw the appended image away. What reached `/usr/bin` was the
  944,632-byte runtime out of a 79 MB download, and running it said only
  "This doesn't look like a squashfs image". The package built, installed and
  verified its checksum at every step, because the truncation happened after
  the checksum was checked. Reported in #377.
- **The Linux desktop AppImage no longer aborts on hosts with a newer Mesa.**
  It failed with `Could not create default EGL display: EGL_BAD_PARAMETER`
  before any window appeared. The AppImage carried its own copies of nine
  display-stack libraries (the wayland client stack, `libxkbcommon`, and
  part of the xcb/X11 stack) and put them ahead of the host's, so the host's
  Mesa was made to talk to the wayland client library from the machine the
  release was built on. Those libraries are now removed from the image after
  it is built. Reported in #378 against v0.2.6 on Mesa 26.2.2 (v0.3.1 bundled
  the same nine).
- **A desktop window that opens black or blank now recovers on the next
  launch.** WebKitGTK's hardware compositing can fail against a driver that
  only partly supports it, and it fails silently. The window opens, nothing
  paints, and there is nothing on stderr to go on. Seen on virtual machines
  using `vmwgfx`. The app now marks each launch and clears the mark once the
  UI has actually drawn a frame, so a launch that never drew one is noticed by
  the next, which turns hardware compositing off and says why.

  This could not be a setting in the app. Every GUI preference lives in the
  webview's `localStorage`, and the webview is the part that is not rendering,
  so someone looking at a blank window cannot reach any of it. Alongside the
  automatic recovery there are now `--disable-gpu-compositing` and
  `--gpu-compositing` flags, which are remembered across launches. Linux only:
  the other two platforms use a web engine with neither the fault nor the
  setting. Also reported in #378.
- **Text in the desktop app's result tables can be selected again.** Both the
  table and its wrapper set `user-select: none`, so a port, MAC address,
  vendor string or banner could not be dragged over with the mouse, and those
  values are on screen precisely so they can go somewhere else. The only route
  out was the detail pane. Selecting rows is a click, not a drag, so nothing
  was gained by it. Reported in #417.
- **The website's release notes lost their paragraph breaks, and the fade over
  a long entry read navy rather than matching the page.** Both on the changelog
  page.

### Changed

- **The website and docs got another pass.** The install section's two
  controls line up and its alternatives stopped shouting. The hero badge shows
  the released version. The interfaces are shown rather than described. The
  README says only what a README can and its TUI screenshots work again. The
  comparison with nmap and the other scanners is fairer in both directions.
  Docs pages carry structured data, and the docs shell picked up a Lighthouse
  gate and two fixes it found.

### Security

- **Three open advisories cleared.** `rustls` 0.23.40 → 0.23.45
  (RUSTSEC-2026-0285, medium), which was in 0.3.1's lockfile and so is in the
  binaries that release produced. The other two are the website's build
  dependencies rather than anything in a release artifact: `adm-zip` ≤0.6.0
  (GHSA-vwc7-r8mq-g2x9 and GHSA-7q85-xj36-vmfc, high) and `devalue` <5.9.1
  (GHSA-9rgm-9g3h-6x36, moderate).

## [0.3.1] - 2026-09-11

The first release since 0.2.6 in May, and a large one, with four months of
work on the desktop app, the shared core and the website.

The headline is the desktop app. Everything listed under it is new to anyone
upgrading from 0.2.6. The old dashboard-style GUI is gone, and what replaces
it is a different application rather than a revision of that one. The rest is
additive work in the core, CLI and MCP server, and a long tail of fixes. The
recurring theme in that tail is code that reported success while doing nothing.

### Added

- **The desktop app is a diagnostic workspace.** NetsCLI Desktop replaces the
  earlier dashboard with a native-like shell built around operation tabs. It
  runs the same `netscli-core` operations as the CLI, TUI and MCP server, so
  its results match the rest of the tool. What it does:
  - Operation tabs you can reorder by drag or keyboard, and close individually,
    to either side, or all at once from a right-click menu.
  - Sortable and filterable result tables, row detail panes, and a preview of
    the CLI command each run is equivalent to.
  - Save a whole workspace of results to a file and reopen it later. Export CSV
    or JSON, whole or selection-only. Exported cells are escaped against
    spreadsheet formula injection, since banners and hostnames are chosen by
    the scanned host.
  - Light and dark themes, and a settings dialog covering probe concurrency,
    default and traffic interfaces, IPv4/IPv6 display preference, history and
    save behaviour, and notification preferences.
  - Full keyboard operation, and a refreshed icon matching the site's brand.
- **Clear the ARP table, then discover.** A chevron beside Run offers a
  cache-flushing variant on discover, sweep and the ARP tab, the tools where a
  stale neighbour entry changes the answer. Clearing needs administrator
  rights. When it fails the run is suppressed rather than quietly returning the
  stale entries it was meant to drop.
- **Richer port scan results across every interface.** Port scans now report
  additive status and detail fields (`open`, `closed`, `filtered`, `error`,
  latency, banners, HTTP metadata, TLS metadata, and raw previews where
  available) while keeping the older `open`, `port`, `service`, and `error`
  fields intact for compatibility.
- **User-configurable probe concurrency.** The CLI and MCP server already
  accepted concurrency limits. The desktop app and TUI settings now expose the
  same control, so probes can be reduced on fragile networks or raised within
  the core safety cap.

### Changed

- **`netscli scan --json` now reports every port, not just the open ones.**
  Filtering to open ports made "all closed", "all filtered" and "every probe
  errored" the same empty array, so a script could not tell a clean scan from a
  host that refused every probe. Each entry carries `open` and `status`, so
  callers that want only open ports can filter for them.
- **The MCP server now scans only local networks by default.** This is the one
  surface driven by a model rather than by the person at the keyboard, so the
  instruction to scan a third party can arrive from a web page or a file
  someone else wrote, and the packets leave from your machine and your IP.
  RFC1918, loopback, link-local and the carrier-grade NAT range overlay
  networks use are allowed. Set `NETSCLI_MCP_ALLOW_PUBLIC_TARGETS=1` to reach
  past them.
- **Scan results returned to a model are capped.** The full probe response
  (`raw`) is no longer included and banners are truncated, both being bytes
  chosen by the scanned host.
- **Tool failures are returned as MCP `isError` results** rather than JSON-RPC
  errors, so a failed scan no longer reads to a client as a broken server.
- **CLI and TUI scan output reflects the richer status data.** Human output
  stays concise, but scanned ports can show closed, filtered and error states
  with latency where available, instead of only emphasising open ports.
- **Windows install guidance prefers Winget for the desktop app.** Winget's
  manifest review and installer hash verification make it the recommended
  Windows path. Direct GitHub Windows installers remain unsigned and may show
  warnings until code signing is added.
- **Linux/macOS install docs clarified.** mDNS is the default pure-Rust
  capability in published builds. Packet capture remains the optional workflow
  depending on libpcap/Npcap.
- **The website and docs were rebuilt.** A consistent shell, unified code and
  table styling, clearer search, and a layout swept across six widths and both
  themes. The brand accent moved from a teal-green that read blue in small text
  to one that reads green at any size.

### Fixed

- **Pinging your own machine no longer reports 100% loss.** On Windows,
  `ping 127.0.0.1` (and the machine's own LAN address) timed out while the
  system `ping` answered immediately. Raw ICMP sockets need administrator
  rights, so an ordinary run fell back to TCP probes on ports 80/443/22 and
  concluded a host was down when nothing answered. A Windows raw socket
  does not observe traffic to an address the host owns. Windows now sends
  echoes through the IP Helper API, which needs no privileges and reaches local
  addresses. Discover and sweep both start from a ping sweep, so both returned
  nothing for any range covering this host.
- **IPv6 hosts can be pinged.** `ping ::1` reported total loss because IPv6 had
  no ICMP path at all and fell through to the same TCP probe. Windows now uses
  `Icmp6SendEcho2`.
- **`netscli arp --clear`, `--add` and `--delete` no longer claim to have
  changed the table when they have not.** On Windows these print "The requested
  operation requires elevation" and then exit 0, so checking the exit status
  alone reported success while nothing was touched. An ordinary run printed
  "ARP entry added for 192.0.2.77", and `"ok": true` in JSON, having done
  nothing. All three now share one check and exit non-zero with the reason.
  `--clear` also errors on platforms where it was never implemented, instead of
  reporting a cleared table.
- **Discover reports devices the OS already knows about.** Results merge probe
  replies with the neighbour table, so a device that answers ARP but not ICMP
  is no longer missing. Each host records whether it was found by probe or by
  neighbour, since a stale neighbour entry can outlive the device.
- **Safety limits were enforced in `Ops` but not in the engines.** The scan,
  sweep, discover and inspect engines are public API re-exported at the crate
  root, and called directly they applied no subnet, port or concurrency cap,
  and `0.0.0.0/0` collected 4,294,967,294 addresses into a `Vec` before
  sending a packet. Every engine now enforces its own limits.
  ([#198](https://github.com/fstubner/netscli/pull/198))
- **Safety limits that only one caller was applying.** `SweepEngine::sweep`
  validates its port list instead of trusting the caller and silently returning
  "no open ports". mDNS browse duration, `ping -c` and packet captures given a
  packet count but no duration all gained the core-side ceiling they were
  documented to have.
- **Port 0 was rejected only by the MCP surface.** Now rejected everywhere.
  ([#164](https://github.com/fstubner/netscli/pull/164))
- **MCP server handled one request at a time.** The read loop awaited each
  handler before parsing the next line, so a slow scan blocked every other
  request on the connection, including cancellation. Handlers now run
  concurrently under a semaphore.
  ([#169](https://github.com/fstubner/netscli/pull/169))
- **Reading the ARP table blocked a runtime worker.** On Windows and macOS it
  shells out to `arp` and waits on the child process. Three callers invoked it
  straight from async code. With MCP handlers capped at 16 concurrent, sixteen
  of these could stall every worker, including the one reading stdin, so no
  further request could even be parsed. Moved to a blocking thread.
  ([#196](https://github.com/fstubner/netscli/pull/196))
- **Four ways an MCP client could wedge or kill the server**: no overall
  request deadline, permits acquired after spawning rather than before, a
  single invalid UTF-8 byte on stdin terminating the process, and client
  disconnect cancelling nothing.
- **The MCP server no longer says it returned everything while truncating.** A
  capped result reported the byte count as its item count, so a 40,000-row scan
  that returned 11,518 rows said `returned: 40000, total: 40000` beside
  `truncated: true`.
- **Packet captures fetched as a background MCP job are bounded like every
  other result.** `get_pcap_capture_result` was routed before the limits that
  strip and truncate remote text, so the one result made entirely of bytes off
  the wire was the one that skipped them.
- **The concurrent packet-capture limit could be bypassed** by calling the
  blocking capture tool, which never registered a job.
- **`discover_network` with no arguments failed on a host whose interface
  carries a /8**, because the substituted default exceeded the /16 cap.
- **A database written by a newer netscli is refused rather than read.** The
  version check treated a future schema as "already migrated", so an older
  build queried tables it had never seen.
- **`netscli trace` no longer prints router-supplied hostnames unsanitised.**
  Hop names come from PTR records controlled by whoever runs those routers, and
  this was the last plain-text output path without the terminal-safety pass
  every other one had.
- **TUI mis-measured wide characters**, so CJK and emoji in a remote-supplied
  hostname or banner pushed box borders out of alignment.
  ([#173](https://github.com/fstubner/netscli/pull/173))
- **Panic paths in the core, and silent corruption in the OUI generator.**
  ([#172](https://github.com/fstubner/netscli/pull/172))
- **winget publishes the version number, not the tag.** Both package manifests
  were passed the tag including its `v`, which the action only strips when the
  input is left empty. `v0.2.2` through `v0.2.6` are already in the public
  catalog that way, so `winget show netscli` reports a version this project
  never issued. Upgrades still work (winget normalises a leading `v` when
  comparing) and this release fixes what is displayed. The publish job now
  asserts `MAJOR.MINOR.PATCH` rather than trusting the strip, because
  winget-pkgs accepted all five without complaint and a merged manifest is
  permanent.
- **AUR packages are published against a re-hashed asset.** Both AUR jobs took
  the published `.sha256` sidecar on trust rather than downloading the asset and
  hashing it, which is the circular check the release scripts exist to prevent.
  The other registries already did this correctly.
- **The Windows installer verifies Npcap before running it.** `install.ps1`
  downloaded the Npcap installer from an overridable URL and launched it
  elevated with nothing checked. It now verifies the Authenticode signature and
  signer, and refuses to run an unsigned or unexpected binary.
- **`install.sh` no longer claims success before installing libpcap.** A user
  who asked for capture support could read "Installed successfully" and get a
  binary that cannot capture.

### Website

- **Small grey text was unreadable on card surfaces.** The docs footer,
  built-with row and mobile section labels use `--sl-color-gray-3`, much of it
  at 12px. It had been raised once to clear 4.5:1 against the page background,
  but nothing checked it against the slightly darker card surface, where it sat
  at 4.44:1.
- **Muted text, and several status colours, were below the readability bar.**
  Eight colour tokens failed WCAG AA (4.5:1) against surfaces they are actually
  painted on. The mint accent failed as text on every light surface, down to
  3.85:1. All 84 foreground/surface combinations now clear 4.5:1, and a check
  keeps them there.
- **The install guide has the verification steps the landing page promises.**
  It advertised checksums and Sigstore signatures and linked to a page with
  none of them on it.
- **The site claimed packet capture in builds that do not ship it**, and
  advertised a version that was never released.
  ([#194](https://github.com/fstubner/netscli/pull/194),
  [#208](https://github.com/fstubner/netscli/pull/208))
- **The interface coverage table no longer conflates separate things.** Rows
  that merged setup with doctor, or reading the ARP table with changing it, are
  split, and dashes that meant "not applicable" say which.
- **The FAQ answers two questions people actually search for**, picked from
  Search Console data rather than guesswork. Is there a `netscan` command,
  and does this replace nmap and have a terminal UI?

## [0.2.6] - 2026-05-06

### Fixed

- **The GUI's in-app version display was stuck at `0.1.0`.** A stale
  `APP_VERSION` constant in `App.tsx` powered both the bottom-bar
  version readout and the About dialog, but it never got bumped
  alongside `package.json`, `tauri.conf.json`, or the workspace
  `Cargo.toml`s. Caught by a Winget moderator on
  [microsoft/winget-pkgs#368471](https://github.com/microsoft/winget-pkgs/pull/368471):
  the v0.2.4 build correctly reported `0.2.4` to the Windows registry
  (Tauri pulls `ProductVersion` from `tauri.conf.json`), but users
  saw `0.1.0` in the GUI itself. Wired `APP_VERSION` to read
  `package.json` at build time via Vite's `define` so the in-app
  display auto-syncs every release going forward.
- **GUI title-bar buttons (close, minimize, maximize) didn't work
  on Windows.** Tauri 2's deny-by-default permission system requires
  explicit `core:window:allow-close/minimize/maximize/unmaximize/start-dragging`
  grants. The app was missing its capabilities config entirely.
  Added `src-tauri/capabilities/main.json`. (#62)

## [0.2.5] - 2026-05-05

### Security

- **hickory-resolver 0.24 → 0.26** closes
  [RUSTSEC-2026-0119](https://github.com/hickory-dns/hickory-dns/security/advisories/GHSA-q2qq-hmj6-3wpp):
  CPU exhaustion during message encoding due to O(n²) name compression
  in `hickory-proto`. The DNS lookup tab and any inspect/discover that
  resolves hostnames are no longer reachable through the vulnerable
  encoding path. The 0.26 builder pattern (`TokioResolver::builder_tokio()`)
  replaces the deprecated `TokioAsyncResolver::tokio` constructor. See
  PR #55 for the source migration. The `.cargo/audit.toml` ignore added
  in #52 was removed once the bump landed.

### Fixed

- **GUI discover/sweep returned only a single host on Windows.**
  Root cause. `detect_default_ipv4_subnet` iterated
  `ipconfig::Adapter::prefixes()` and grabbed the first IPv4 entry, but
  that list contains the host's own /32, broadcast /32, multicast /4,
  link-local /16, and the network /24. Windows reports the host /32
  first, so the "subnet" was a single IP. New helper
  `pick_ipv4_subnet_from_prefixes` filters to network-shaped prefixes
  (length 1..=30, not multicast, not link-local) and truncates host
  bits, matching the Linux path. 5 unit tests added that run on every
  CI platform via `cfg(any(windows, test))`. (#59)
- **The GUI dashboard's "Recent Scans" rendered with wrong colors / not as
  list rows.** `.history-item` is a `<button>` (for keyboard
  accessibility) but the CSS didn't reset user-agent button styles.
  WebView2 on Windows applied Win32 chrome (`color: ButtonText`,
  centered text, content-fit width, system button font), breaking the
  inherit chain for child labels. Explicit reset added. (#59)

### Changed

- **Dependencies (all transitive, no API surface impact):**
  - `crossterm 0.27 → 0.28` + `tui-textarea 0.4 → 0.7` had to land
    together, as tui-textarea 0.7 hardcodes `crossterm = "0.28"`. (#58)
  - `mdns-sd 0.13 → 0.19`, adapting to the new `ScopedIp::to_ip_addr()`
    accessor in `netscli-core/src/mdns.rs`. (#58)
  - `clap 4.5.60 → 4.6.1` (#43), `pcap 1.3 → 2.4` (#45),
    `clap_mangen 0.2.33 → 0.3.0` (#46),
    `dialoguer 0.11.0 → 0.12.0` (#48), `dirs 5.0.1 → 6.0.0` (#51),
    `tokio 1.52.1 → 1.52.2` + `clap_complete 4.6.2 → 4.6.3` (#57).
- **`ratatui 0.29 → 0.30` deferred:** tui-textarea has no version yet
  that supports ratatui 0.30 (latest 0.7 still pins ratatui 0.29).
  Tracked via `@dependabot ignore` on the closed PR #49.

### Added

- **Release pipeline GUI automation.** `publish.yml` extended with 4
  parallel jobs that publish the GUI bundles to Homebrew Cask, Scoop
  extras (`netscli-gui.json`), Winget (`fstubner.netscli.gui`), and
  AUR (`netscli-gui-bin`) on every tagged release. (#54, #53, #56)

## [0.2.4] - 2026-05-03

### Fixed
- **GUI bundle path** in release.yml's GUI matrix was rooted at
  `apps/netscli-gui/src-tauri/target/${TARGET}/release/bundle/`. Cargo
  workspaces actually use the **workspace-root** `target/` directory
  regardless of which subcrate's directory cargo was invoked from, so
  Tauri's bundle output lives at `target/${TARGET}/release/bundle/`.
  v0.2.3 built the `.deb` / `.dmg` / `.msi` correctly but the collect
  step found an empty bundle dir and skipped everything, and sigstore-sign
  then failed trying to sign nothing.
- **AUR deploy action** (`KSXGitHub/github-actions-deploy-aur`) was
  pinned to `@v2.7.0` (April 2024), which has a `bash: --command:
  invalid option` regression in its container entrypoint. Bumped to
  `@v4.1.3` (current stable, same input shape).

### Notes
- CLI release shipped with 44 assets, sigstore-signed, on the v0.2.3
  release page.
- Homebrew, Scoop, Winget, and crates.io all updated to 0.2.3.
- AUR is still on the previous version (failed to push).
- 0 GUI installers attached to v0.2.3 release.

## [0.2.3] - 2026-05-03

### Fixed
- **Tauri version skew** broke all 4 GUI installer builds in v0.2.2's
  release matrix. The Cargo.toml constraint `tauri = "2.0.0"` resolved
  to `tauri 2.9.5`, but npm `@tauri-apps/api: ^2` resolved to `2.10.1`.
  Tauri's CLI rejects same-major different-minor as a version
  mismatch. Loosened the Rust constraint to `tauri = "2"` and ran
  `npm update --save` so both sides land on the same minor (currently
  `2.11.0`). Verified with a local `npm run tauri build` producing
  `NetsCLI_0.2.3_x64_en-US.msi` cleanly.
- **AUR publish job in publish.yml** failed on v0.2.2 with a confusing
  `bash: --command: invalid option` error from the deploy action's
  internals. Root cause. Rendered PKGBUILD was written to `/tmp/
  PKGBUILD`, but the `KSXGitHub/github-actions-deploy-aur` action runs
  in a Docker container that only mounts `$GITHUB_WORKSPACE`, so files
  in `/tmp` are invisible inside the container. Render now writes to
  `packaging/aur/PKGBUILD` (workspace-relative) before handoff.

### Notes
- CLI binaries shipped successfully on v0.2.2, and `cargo install`,
  `brew install netscli`, and `scoop install netscli` all give v0.2.2.
- v0.2.2 GitHub release has CLI assets but no GUI installers.
- AUR `netscli-bin` was last bumped to v0.2.0, and it'll catch up to
  v0.2.3 directly.

## [0.2.2] - 2026-05-03

### Fixed
- Cargo.lock was out of sync with Cargo.toml at the v0.2.1 tag, because
  `tokio 1.52.1` (bumped in #17) requires `socket2 >= 0.6.3`
  transitively, but Dependabot only regenerated the direct-dep entries
  in the lock. CI's lint paths use `cargo build` (no `--locked`) so
  this slipped through, but release.yml uses `--locked` to guarantee
  reproducible builds, and all 17 release builds for v0.2.1 failed at
  the lockfile check.
- 0.2.2 regenerates the lockfile so `socket2 0.6.3` is recorded
  alongside the existing `0.5.10`. No application code changes.

### Notes
- Released to crates.io but the GitHub release page has no attached
  binaries (release.yml never produced any). `cargo install netscli`
  works because cargo regenerates the lockfile per-user, but downloads
  from the GitHub release / package managers should use 0.2.2.
- 0.2.1 is left in place as crates.io history rather than yanked.

## [0.2.1] - 2026-04-30

### Added
- Prebuilt desktop GUI installers attached to every release: `.msi`
  (Windows x86_64), `.dmg` (macOS aarch64 + x86_64), `.deb` and
  `.AppImage` (Linux x86_64). Each is sigstore-signed alongside the
  CLI binaries. macOS `.dmg` ships unsigned for now, so right-click →
  Open to bypass Gatekeeper, or run
  `xattr -dr com.apple.quarantine /Applications/NetsCLI.app`.
- `--concurrency <N>` (alias `-j <N>`) global CLI flag for tuning
  in-flight network operations. Default stays at 256 and is clamped to
  [1, 1024]. Useful on fragile home gateways that can't keep up with
  hundreds of simultaneous probes.

### Changed
- Bumped `pnet_packet`, `pnet_transport`, `pnet_datalink`, and
  `pnet_sys` from 0.34 to 0.35.
- Bumped `sysinfo` from 0.30 to 0.38. New `Networks::refresh(true)`
  semantics drop hot-unplugged interfaces from the cached map rather
  than retaining stale RX/TX stats.

### Notes
- `ipnetwork` stayed at 0.20 because `pnet_datalink 0.35` still pins
  it transitively, and will revisit when upstream pnet relaxes the
  constraint.

## [0.2.0] - 2026-04-18

### Added
- `netscli completions <bash|zsh|fish|powershell|elvish>` subcommand that
  writes a shell-completion script to stdout. Package managers
  regenerate completions at install time by shelling out to the
  installed binary, so they never drift from the CLI surface.
- `netscli man` subcommand that renders the roff-format man page from
  the clap command tree to stdout.
- Sigstore keyless signing in `.github/workflows/release.yml`. Every
  release asset now ships with a `.sig` + `.pem` alongside the `.sha256`,
  verifiable by anyone with `cosign verify-blob`. No paid cert, no
  long-lived secrets. It uses the GitHub Actions OIDC token exchanged via
  Fulcio for a short-lived signing cert bound to the workflow + commit +
  tag.
- `packaging/` directory with submission templates for Homebrew (tap),
  Scoop (bucket), Winget (microsoft/winget-pkgs via wingetcreate), and
  Arch AUR (`netscli-bin`). Each has a README with the submission flow
  and VERSION_SHA256_* placeholders that get stamped with real
  checksums on release day.
- **mDNS / DNS-SD service discovery.** New `netscli-core::mdns` module
  (behind the `mdns` feature) with `MdnsEngine::discover` and
  `discover_common` on top of the pure-Rust `mdns-sd` crate. Browses a
  curated set of service types (`_http._tcp`, `_ssh._tcp`,
  `_airplay._tcp`, `_googlecast._tcp`, `_ipp._tcp`, …) in parallel and
  returns devices with hostname, resolved IPv4/IPv6 addresses, port,
  service type, and full TXT record properties.
- New CLI subcommand `netscli mdns [--timeout-ms N] [-t <service_type>]`
  with text, JSON, and YAML output. Text output is device-centric:
  one block per hostname with its addresses and announced services.
- New TUI slash command `/mdns [--timeout <ms>]`.
- New MCP tool `discover_mdns` accepting `timeout_ms` (default 3000,
  clamped 100–30000) and optional `service_types`. Returns the same
  structured payload as the CLI `--json`, so agents can filter by
  model (`properties.md`), friendly name (`properties.fn`), or service
  type without an extra pass through text output.
- The `netscli` binary and the `netscli-mcp` default feature both
  include `mdns` so the capability ships by default in published
  artifacts.
- `netscli_core::Error` typed-error enum and `netscli_core::Result<T>`
  alias. Library consumers can now pattern-match on
  `InvalidInput` / `Dns` / `Network` / `Timeout` / `Unsupported` / `Io`
  / `Database` / `Pcap` / `Other` instead of passing around an opaque
  `anyhow::Error`. The enum is `#[non_exhaustive]` so new variants
  can land without being breaking changes.
- `netscli-core` feature `db` gating the SQLite `Database` type (and
  its sqlx + chrono deps). Default build is ~35% smaller transitive
  crate graph (256 → 167). The `netscli` binary opts in to `db`, while
  library consumers can stay lean with `default-features = false`.
- `cargo-audit` CI workflow (`.github/workflows/audit.yml`) running on
  push / PR / weekly schedule, with a documented `.cargo/audit.toml`
  ignore list for transitive advisories that aren't reachable under
  our feature set.

### Changed
- **All public functions** in `netscli-core` now return
  `netscli_core::Result<T>` with structured error variants instead of
  `anyhow::Result<T>`. Covers `common::parse_ports*`, the full `dns`
  module, the `Ops` surface, `InspectEngine`, `SweepEngine`,
  `NetworkManager::{get_arp_table, add_entry, delete_entry, clear_table}`,
  `PcapEngine`, and `Database`.
- `Error` variant mapping by module:
  - `common`, `ops` subnet/record parsing → `InvalidInput`
  - `dns` resolver failures → `Dns`, timeouts → `Timeout(ms)`
  - `ops::resolve_host_ip_with_timeout` unresolved host → `Dns`
  - `pcap` unsupported (build-time or no interfaces) → `Unsupported`
  - `arp` process-exec failures and permissioned ops → `Other` (with
    the permission hint in the message, and a dedicated `PermissionDenied`
    variant may land later)
  - `Database` (sqlx) errors → `Database` variant via `#[from]`
  - `pcap` runtime errors → `Pcap` variant via `#[from]`
- A few private helpers in `ping.rs` (ICMP round-trip internals) keep
  `anyhow::Error` because they never reach the public surface.
- Extracted section headings + leads into `site.copy` so the landing
  page is 100% data-driven, with no per-project strings in components.

## [0.1.1] - 2026-04-17

### Added
- Per-crate `README.md` for `netscli-core`, `netscli-mcp`, and
  `netscli` so their crates.io pages have real content rather than
  just the one-line description.
- `CHANGELOG.md`, `SECURITY.md`, and `docs/DEVLOG.md`.
- `.github/dependabot.yml` replacing the inherited default. Groups
  patch/minor bumps, keeps first-tier deps (tauri, sqlx, tokio,
  hickory) as individual PRs, gives the frontend bundler stack its
  own grouped PR.

### Changed
- Bumped `sqlx` dep in `netscli-core` from 0.7 to 0.8. No source
  changes needed. Our usage is entirely `query()` / `query_as::<_, T>()`
  / `FromRow`, and the 0.8 breaking changes affected other paths. This
  drops GHSA-xmrp-424f-vfpx from the advisory noise even though it was
  never reachable with our `sqlite`-only feature set.
- Consolidated the OUI vendor dataset under
  `crates/netscli-core/data/oui.min.json.gz`. It used to live at the
  workspace root and wasn't bundled in the published crate.
- Reorganised `docs/` into `docs/screenshots/` and `docs/assets/`.
- `README.md`: primary install instruction is now
  `cargo install netscli` (was git-URL form). crates.io / Release /
  Downloads badges are live.

### Fixed
- Release build workflow now triggers on `release: [published]` and
  supports `workflow_dispatch` with a tag input. Previously it listened
  on `[created]`, which GitHub's anti-loop protection suppresses when
  release-drafter creates the draft, so no platform binaries were ever
  built automatically for v0.1.0.
- Npcap SDK install step in the release workflow was pointing `LIB` at
  the wrong path (the 1.13 zip has `Lib/` at its root, no wrapping
  `npcap-sdk/` folder). Windows pcap variant now builds.
- `ubuntu-24.04-arm64` runner label corrected to `ubuntu-24.04-arm`,
  so the ARM64 Linux matrix jobs no longer queue forever.

### Security
- Dropped CVE-flagged dep versions from the tree through transitive
  patches (`bytes`, `time`, `rand`, `rsa`) and the `sqlx` major bump.
  None of the CVEs were reachable under our feature flags, but
  keeping flagged versions around cluttered the alert feed.

## [0.1.0] - 2026-04-17

First public release. CLI, TUI, desktop GUI, and MCP server all
backed by the same core library.

### Added
- `netscli-core` covers host discovery, port scan, DNS lookup (all record
  types), reverse DNS, ARP with vendor resolution, network sweep,
  ping, traceroute, interface listing, optional libpcap packet
  capture. OUI vendor DB ships embedded in the crate.
- `netscli-mcp` is a JSON-RPC MCP server exposing nine tools over stdio
  for Claude Code / Cursor / any MCP client.
- `netscli` is the CLI + ratatui TUI. `netscli <cmd>` for scripts,
  `netscli` alone for the interactive TUI, `netscli serve` for the
  MCP server.
- `netscli-gui` is a Tauri 2 + React 19 desktop app with dashboard,
  scan, DNS, interfaces, and settings views.
- `--json` / `--yaml` structured output on every non-interactive
  subcommand.
- Release binaries for Windows x86_64, Linux x86_64/aarch64 (glibc)
  and x86_64 (musl), macOS x86_64/aarch64, each with and without
  pcap.
- GitHub Pages landing at https://netscli.com with Cloudflare Web
  Analytics.
- Install scripts (`install.sh`, `install.ps1`) with optional
  `NETSCLI_PCAP=1` flag that downloads the pcap variant and installs
  the platform's packet-capture library.

### Known limitations
- `sqlx 0.7` in the `netscli-core` dep tree surfaces a PostgreSQL
  binary protocol advisory (GHSA-xmrp-424f-vfpx). Not reachable since
  only the `sqlite` feature is enabled. Planned hygiene bump to
  `sqlx 0.8` in v0.1.1.
- Desktop app needs the WebView2 runtime on Windows. Most Windows
  10/11 systems have it preinstalled.

[Unreleased]: https://github.com/fstubner/netscli/compare/v0.3.5...HEAD
[0.3.5]: https://github.com/fstubner/netscli/releases/tag/v0.3.5
[0.3.4]: https://github.com/fstubner/netscli/releases/tag/v0.3.4
[0.3.3]: https://github.com/fstubner/netscli/releases/tag/v0.3.3
[0.3.2]: https://github.com/fstubner/netscli/releases/tag/v0.3.2
[0.3.1]: https://github.com/fstubner/netscli/releases/tag/v0.3.1
[0.2.6]: https://github.com/fstubner/netscli/releases/tag/v0.2.6
[0.2.5]: https://github.com/fstubner/netscli/releases/tag/v0.2.5
[0.2.4]: https://github.com/fstubner/netscli/releases/tag/v0.2.4
[0.2.3]: https://github.com/fstubner/netscli/releases/tag/v0.2.3
[0.2.2]: https://github.com/fstubner/netscli/releases/tag/v0.2.2
[0.2.1]: https://github.com/fstubner/netscli/releases/tag/v0.2.1
[0.2.0]: https://github.com/fstubner/netscli/releases/tag/v0.2.0
[0.1.1]: https://github.com/fstubner/netscli/releases/tag/v0.1.1
[0.1.0]: https://github.com/fstubner/netscli/releases/tag/v0.1.0
