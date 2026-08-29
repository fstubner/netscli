# UX walkthrough

Two surfaces, each with its own journeys: the **desktop app** and the
**website** (`site/`, netscli.com — landing page, docs and changelog).

The flows an acceptance pass should walk, step by step, against a running
build and a served site. Written from the shipped app; each step below was observed rather
than intended. Where a step depends on privileges or the local network, the
condition is stated so a failure can be attributed correctly.

The CLI, TUI and MCP surfaces have no walkthrough: they are exercised by
`docs/` and by their own tests, and neither has states a person navigates.

---

# Desktop app

Scope: `apps/netscli-gui`.

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
2. **Run discovery.** Press the run button, which carries the tool’s own
   name and so reads "Discover" here. The chevron beside it offers "Clear
   ARP table, then discover", on discover, sweep and the ARP tab only.
   Progress replaces the empty table while the sweep runs.
3. **Read the results.** Each host is a row: IP, hostname, MAC, vendor, RTT,
   and **Found by**, reading either `probe reply` or `neighbour table`. The
   second means the host answered nothing and is only remembered by the OS,
   which can outlive the device — so it is the column to distrust when
   something looks stale. Selecting the row says the same in words.

   The column exists because the app used to call every discovered host a
   “Responded host”, including the ones that had answered nothing.
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
   save a result bundle. Success is confirmed by a toast *only with
   interaction toasts enabled*, which is not the default; the file appearing
   is the signal. **Failure is not optional** — it goes to the tab's error
   strip whatever the toast preferences say, because a failed export writes
   nothing, and a silent nothing is indistinguishable from a success.

## States

Each of these is a real state the app can be in, and each is worth
exercising deliberately.

| State | What should happen |
| --- | --- |
| **Empty** — a tab created but never run | Form and Run control visible; the table shows no rows and does not pretend to. |
| **Running** | Progress with counts; Stop is enabled; other tabs stay usable. |
| **Empty result** — the run succeeded and found nothing | Says "This run completed and found nothing." Distinct from "not yet run", and from a filter hiding every row, which says that instead. A `/30` with nothing on it is a legitimate answer, not a failure. |
| **Operation failure** | The tab's **error strip** shows the reason. It is unconditional and not preference-gated — a failed run leaves the table empty, so without it the cause is invisible. |
| **Privilege failure** | Named explicitly, e.g. "Failed to clear ARP table: … requires elevation." The run that depended on it is **suppressed**, not continued, because a discover after a failed ARP clear looks identical to one after a successful clear. |
| **Capability unavailable** — e.g. packet capture without the driver | The tool reports why rather than failing opaquely. |
| **Completion, tab in background** | A toast carrying an "Open tab" action, *only with operation toasts enabled* — which is not the default. At defaults this state is silent, and that is correct. |
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

---

# Website

Scope: `site/` — the landing page, the docs, and the changelog, served as a
static build. Written by walking a served production build at 1440px and
375px; the structure below is what is there, not what was intended.

This section did not exist while the site shipped, which is why nothing had
ever walked it. Every journey here is one a person actually performs; a step
that cannot be completed is a finding, not a curiosity.

## Primary job

**Decide whether NetsCLI is worth installing, then install it.**

Everything else on the site serves that or follows from it: the docs explain
what you just installed, and the changelog says whether to update.

Search engines and language models are a second audience for the same
content, which is why the copy has to answer a question rather than describe
a feature. They are not a separate journey — a page that reads well for a
person and states plainly what the tool does serves both.

## Steps

### A. Evaluate — "what is this, and is it for me?"

1. **Land.** The hero states what NetsCLI is in one line, with the current
   release, star count and download total beside it. Each of those three is
   hidden until GitHub confirms it, so an unauthenticated rate limit shows
   nothing rather than something wrong.
2. **Scan the surfaces section** (`#surfaces`) — desktop app, terminal UI,
   CLI, MCP server — and recognise which one is yours.
3. **Reach the FAQ** (`#faq`), 13 questions in 4 groups: what it is, install
   and updates, interfaces and integrations, network workflows, limits and
   dependencies. These carry the comparison questions people actually search
   for ("alternative to Angry IP Scanner", "replace nmap").
4. **Leave for the source** if that is the decision — the GitHub link is in
   the top nav and in the hero.

### B. Install — "give me the command"

1. **Reach `#install`**, from the nav or the hero CTA.
2. **Pick a platform** — Windows, macOS, Linux tabs. The tab set is the
   first choice because a command for the wrong OS is worse than none.
3. **Pick a form** — desktop app or CLI + terminal UI. These are separate
   products with separate package names, and the page must not blur them.
4. **Copy a command**, or download an installer directly. Every command has
   a copy button; the download links resolve through
   `/releases/latest/download/…` so they never name a version that has moved
   on.
5. **Verify, if you care** — checksums and signing are stated with a link to
   the verification steps.

### C. Learn — "how do I do the thing"

1. **Enter the docs**, from the nav or a search engine landing on a deep
   page. Either is a first page, so every page has to stand alone.
2. **Orient**: left sidebar for the section list, right rail for the
   contents of this page, breadcrumb for where you are.
3. **Search** (`Ctrl K`, or the button on narrow screens) when the nav does
   not have the word you are thinking of.
4. **Follow an anchor** to a heading, and share that link.
5. **Move between pages** with the sidebar, keeping your place.

### D. Check what changed — "should I update?"

1. **Open the changelog**, from the nav or from a version number.
2. **Read the newest release first**; each entry says what changed and why
   it matters, with install, compatibility or security notes called out.
3. **Tell released from unreleased.** An entry with no published release
   behind it is labelled and is not linked, because a link would 404.

### E. Recover — "that link was wrong"

1. **Hit a 404** and get a page that says so and offers a way back, rather
   than a dead end.

### Narrow screens

Each journey above has a narrow variant, and they are where this site has
historically broken:

- The section list collapses behind a menu control; the page contents
  collapse into a dropdown under the hero.
- Search becomes a full-screen dialog rather than an inline field.
- The install tabs and command blocks must not overflow horizontally; a
  command you cannot read is a command you cannot copy.

## States

| State | What should happen |
| --- | --- |
| **First paint, no JavaScript** | Every page's content is in the HTML, including the changelog entries. Nothing says "Loading". |
| **GitHub unreachable or rate-limited** | Hero metrics stay hidden; the changelog still lists every release from the repo's own file, unlinked and marked not-yet-released. Nothing shows a stale or invented number. |
| **A version in the changelog with no release** | Labelled "Not yet released", and deliberately not linked. |
| **Search index unavailable** | The dialog says so in its own voice, rather than appearing empty or hanging. |
| **Theme: dark, light, or following the system** | All three are selectable and all three are legible; the control shows which is active. |
| **Deep-linked to an anchor** | The target heading is visible and not hidden behind sticky chrome. |
| **Narrow viewport** | No horizontal overflow on any page. Every command block scrolls within itself rather than widening the page. |
| **Print** | Navigation chrome is dropped; the article survives. |

## Known gaps

Recorded so an acceptance pass reports what is new rather than what is
already known. All were measured on a served production build.

- **Page padding is asymmetric.** At 1440px a docs page leaves 29px to the
  left of the sidebar and 92px to the right of the contents rail.
- **The two narrow-screen header controls do not match.** Search is
  `rgba(17,22,29,0.9)` with a `rgba(140,149,166,0.24)` border; the menu
  toggle is `rgba(255,255,255,0.035)` with a `rgba(255,255,255,0.1)` border.
  Same size, same radius, different surface.
- **The install section is dense** — 45 copy controls on one page — and the
  relative prominence of package manager, script and direct download has not
  been decided deliberately.
- **Typography scale is unreviewed** and reads large at desktop widths.
- **The coverage matrix states capabilities as Yes/No** where several rows
  are not applicable rather than absent, and it treats the CLI, TUI and MCP
  as fully separate when they share one binary and one core.
- **Mobile search layout**: the clear control and the cancel affordance
  compete, and the results panel does not extend to the bottom of the
  viewport.
- **Anchor links jump the page** rather than moving to the heading quietly.
- **The sidebar's active marker shifts** when a different item is hovered.
- **Breadcrumb separators sit low** relative to their text.
- **The theme control's focus ring is drawn incorrectly**, and its dropdown
  is unstyled.

No `design-direction.md` covers this surface: that document scopes itself to
the desktop app. Until one exists, "does this look right" has no written
answer here, and that is the root of most of the list above.
