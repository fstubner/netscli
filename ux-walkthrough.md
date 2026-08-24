# UX walkthrough — NetsCLI desktop app

The flow an acceptance pass should walk, step by step, against a running
build. Written from the shipped app; each step below was observed rather
than intended. Where a step depends on privileges or the local network, the
condition is stated so a failure can be attributed correctly.

Scope: `apps/netscli-gui`. The CLI, TUI and MCP surfaces have their own
documentation under `docs/`.

## Primary job

**See what is on this network, and confirm whether a given host or port is
reachable — without opening a terminal.**

Everything else in the app supports that: the other tools are the follow-up
questions you ask once discovery has told you an address exists.

## Steps

1. **Launch.** The window opens on a **Discover** tab, pre-filled with the
   subnet of the default interface. Discover is the entry point because the
   first useful question on an unfamiliar network is "what is on it", and a
   scan needs a host you do not have yet.
2. **Run discovery.** Press Run (or the chevron beside it for "Clear ARP
   table, then discover", offered only on discover, sweep and the ARP tab).
   Progress replaces the empty table while the sweep runs.
3. **Read the results.** Each host is a row: IP, hostname, MAC, vendor, RTT.
   A `found_by` value records whether the host answered a probe or is only
   known from the OS neighbour table — the latter can outlive the device, so
   it is the column to distrust when something looks stale.
4. **Select and inspect.** Click a row, or navigate with the arrow keys;
   Ctrl+A selects all. The detail pane below shows the selected row's
   fields and the raw result.
5. **Ask a follow-up.** From a host, open a port scan or an inspect tab.
   Each tool is a tab, and tabs are independent — a long sweep in one does
   not block another.
6. **Read the equivalent command.** The command strip under the results
   shows the `netscli …` invocation matching the current form, so anything
   done in the UI can be reproduced in a shell or a script.
7. **Take the results away.** Export JSON or CSV, copy selected rows, or
   save a result bundle.

## States

Each of these is a real state the app can be in, and each is worth
exercising deliberately.

| State | What should happen |
| --- | --- |
| **Empty** — a tab created but never run | Form and Run control visible; the table shows no rows and does not pretend to. |
| **Running** | Progress with counts; Stop is enabled; other tabs stay usable. |
| **Empty result** — the run succeeded and found nothing | Distinct from "not yet run". A `/30` with nothing on it is a legitimate answer, not a failure. |
| **Operation failure** | The tab's **error strip** shows the reason. It is unconditional and not preference-gated — a failed run leaves the table empty, so without it the cause is invisible. |
| **Privilege failure** | Named explicitly, e.g. "Failed to clear ARP table: … requires elevation." The run that depended on it is **suppressed**, not continued, because a discover after a failed ARP clear looks identical to one after a successful clear. |
| **Capability unavailable** — e.g. packet capture without the driver | The tool reports why rather than failing opaquely. |
| **Completion, tab in background** | A toast, carrying an "Open tab" action. |
| **Completion, tab in foreground** | No toast. The result arriving in the table is the signal; repeating it teaches people to ignore toasts. |
| **Preferences at defaults** | Toasts off; concurrency 256; opens on Discover. A profile left at 1 probe by the pre-0.3.1 defect is repaired once, on upgrade. |

## Known gaps

Recorded so an acceptance pass does not report them as new:

- The end-to-end suite (`npm run test:tauri-render`) runs only locally, never
  on hosted CI, because it builds and drives the real app.
- Selenium's native `.click()` does not register as a React click against
  the attached WebView2 session; a DOM `.click()` does. A menu item that
  appears dead under the harness may be working for a user, and vice versa —
  verify interaction findings both ways before believing either.
- The MSI has never been tested on a clean machine without WebView2
  preinstalled.
