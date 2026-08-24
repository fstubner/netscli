# Design direction — NetsCLI desktop app

Scope: the Tauri desktop app in `apps/netscli-gui`. The marketing and docs
site (`site/`) is a separate surface with its own Starlight-derived styling
and is not covered here.

Reconstructed from the shipped implementation — `src/styles/tokens.css` and
the components that consume it — rather than from an interview held before
the design existed. Anything not directly readable from the code is marked
`[inferred]`.

## Interview

**What is this, in one line?**
A desktop window over the same Rust core the CLI and TUI use, for when you
want to see what is on the network without opening a terminal.

**Who is looking at it?**
Per `PRODUCT.md`, specialists first and non-specialists third. The app is
the surface most used by the non-specialist group, but it is not allowed to
buy their comfort with a specialist's accuracy. `[inferred]` — this follows
from the stated user ordering rather than from a design note.

**What should it feel like?**
A terminal tool that happens to have a window: dense, quiet, and quick to
read, rather than a consumer app with generous whitespace. Evidence: the
compact control heights (tab strip 38px, status bar 27px), the monospace
treatment of commands and addresses, and the CLI command strip under the
results showing the equivalent `netscli …` invocation for whatever the UI
just did.

**Colour.**
Dark by default, with a light theme defined in the same token block. Near
-black backgrounds layered by elevation (`--bg-body` `#0d1015` → `--bg-base`
`#181c24` → `--bg-elevated` `#20242d`), low-contrast borders
(`--border-subtle` `#2a303b`), and a single mint accent (`--mint` `#3eddb0`)
carrying interaction and success. Cyan (`#1edcff`), red (`#ef4456`) and
amber (`#f5a524`) are reserved for state, not decoration.

Every colour is a token on `.container`; components reference tokens, never
literals. This is enforced by convention rather than by a checker
`[inferred]` — no lint rule for it exists in the repo.

**Type.**
Inter (with a Segoe UI / system fallback) for interface text; Cascadia Code
/ JetBrains Mono for anything the user could paste into a shell — commands,
IPs, MACs, ports. The split is semantic: monospace means "this is literal".

**Density and hierarchy.**
Results are tables, and the table is the primary object on screen; the form
above it and the detail pane below it are supporting. Row selection,
keyboard navigation (arrows, Home/End, Ctrl+A, shift-range) and multi-select
are first-class, because the specialist user copies rows out.

**Motion.**
Minimal and functional — progress during an operation, a toast that
auto-dismisses. No decorative animation. `[inferred]` from the absence of
any transition longer than ~120ms in the stylesheets.

**What it must never do.**
Present a result as certain when the underlying probe failed. The error
strip is unconditional and not preference-gated for this reason, and
completion toasts were deliberately narrowed to background tabs only —
announcing what is already on screen trains people to ignore the messages
that matter.
