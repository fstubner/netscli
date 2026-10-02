# Testing strategy

What each suite defends, what it structurally cannot catch, and how that was
measured rather than assumed.

## The suites

| Suite | Command | Runs in CI | Defends |
|---|---|---|---|
| unit | `npm test` | every job | Parsing, scoping, ranking mechanics, config writing. The bulk of the suite. |
| integration | `npm run test:integration` | yes | The five MCP tool handlers end to end against a fixture service — the wiring and the payload shapes, not the index. `tests/handoff/` covers the real index. |
| drift | `npm run test:drift` | yes | Each scraper against a recorded sample of the tool's real on-disk format. |
| smoke | `npm run test:smoke` | yes | The built CLI, spawned as a host tool spawns it, against seeded stores. |
| eval | `npm run test:eval` | `checks` job | Retrieval *quality* — MRR, top-1, recall@5 against a committed baseline. |
| security | `npm run test:security` | yes | Path containment, prompt-injection fencing, atomic writes. |

`npm test` deliberately excludes smoke, drift and eval: they build, spawn
processes and load a real embedding model. Everything is run before merge —
nothing is CI-only in the sense of never running — but a developer running
`npm test` locally is not running the same thing CI runs.

## What each layer cannot catch

Named because each of these has actually shipped a defect.

- **Unit tests cannot catch wiring.** They construct the object under test
  directly, so they pass while the thing that builds it in production is
  wrong. Setup wrote an MCP server and a hook and the tools were still refused
  because a permission list was missing; the session-start hook forked a
  background scan that never survived under a real host. Both had green unit
  tests. This is what the smoke suite is for, and why it spawns the built CLI
  rather than importing it.
- **Fixtures cannot catch format drift.** A scraper test feeds the parser a
  shape someone wrote by hand, which is the shape the parser already expects.
  The drift suite exists because transcript formats belong to other vendors
  and change without notice.
- **Nothing here catches a host tool's own behaviour.** Whether Claude Code
  applies `permissions.allow` in an untrusted workspace, whether it tears down
  a hook's process tree — those were found by running the product against real
  tools, and no suite in this repo can assert them. When a change depends on
  host behaviour, run it against the host.
- **The eval measures quality, not correctness.** It will notice ranking
  getting worse. It will not notice a session going missing.

## Mutation, not coverage percentage

Coverage is measured here by breaking code and checking something goes red. A
line-coverage number cannot distinguish a line that is executed from a line
that is *defended*, and every real gap found in this repo was found the second
way.

A sweep on 2026-09-03 changed ten load-bearing constants one at a time and ran
each suite against each mutation:

| Mutation | unit | eval | Outcome |
|---|---|---|---|
| confidence gate to 0 | killed | — | covered |
| result limit clamped to 1 | killed | — | covered |
| retrieval-unit reconcile disabled | killed | — | covered |
| corroboration weight to 0 | **survived** | killed | eval-only — now also unit |
| tie-break weight to 0.9 | **survived** | killed | eval-only — now also unit |
| window stride to no overlap | **survived** | killed | eval-only — now also unit |
| candidate windows per session to 1 | **survived** | killed | eval-only — now also unit |
| matches per session to 1 | **survived** | **survived** | gap — now closed |
| resume cursor overlap to 0 | **survived** | **survived** | gap — now closed |
| preview source chars to 1 | **survived** | **survived** | gap — now closed |

A fourth sweep on 2026-09-03 covered `src/{cli,runtime,utils,tools}`:

| Mutation | Outcome |
|---|---|
| project boundary: dotfile traversal guard off | killed |
| atomic write: containment check off | killed |
| `inlineSafe` stops fencing untrusted text | killed (4 tests) |
| redirected store never reported | killed |
| duration: unparseable reads as zero | killed |
| hook trusts a payload naming any project | killed by **smoke only** |
| `status` always reports "never scanned" | **survived** — now closed |
| `normalizeTools` shape guard removed | **survived** — not a gap, see below |

The `normalizeTools` survivor is a redundant early return rather than missing
coverage: a string, an array, a number and `null` all produce the same result
with or without it, because the per-entry check below already rejects them.
Left in place as intent, like the unreachable quote escape in `toFtsQuery`.

The hook row is the suite split working, not a gap — that guard is a wiring
question and the smoke suite is where wiring is tested.

Two further gaps were found the same way and closed: deleting the evidence
filter left the whole suite green, because the nonsense-query tests are
actually satisfied by the confidence gate below it; and the vector backlog an
agent is told about could read zero while nothing was embedded.

The three "gap" rows were the dangerous ones. The resume-cursor overlap in
particular loses messages silently: the cursor lands on the newest timestamp
read, and any message sharing that timestamp is never yielded again.

### The config and MCP sweep

A second sweep on 2026-09-03 broke 33 load-bearing behaviours across
`src/config/**` and `src/mcp/**`, one line at a time. Twenty-six were killed by
the unit suite, two more only by smoke, and five survived everything. Those
five are now closed, each by a test verified to fail against the exact mutation
that survived it:

| Mutation | Killed by | Outcome |
|---|---|---|
| project root rendered without `stripMarkers` | **nothing** | gap — now unit |
| disconnect strips permissions by `mcp__` prefix | **nothing** | gap — now unit |
| manifest filters passed through unvalidated | **nothing** | gap — now unit |
| manifest reports `indexing: null` while scanning | **nothing** | gap — now unit |
| unparsable MCP config reported as wired | **nothing** | gap — now unit |
| not-configured notice reaches only the first tool | smoke | smoke-only, correct |
| not-configured notice reads as an empty project | smoke | smoke-only, correct |

Two patterns are worth naming, because both are the same mistake:

- **A guard existing is not a guard being called.** `stripMarkers` had four
  tests of its own, all green, while the renderer interpolated the project path
  raw beside them. A path containing the end marker — legal on POSIX — closes
  the block early, so disconnect leaves the block's tail and a stale marker
  behind in the user's committed `CLAUDE.md`, and every later run compounds it.
  Testing the helper is not testing the call site.
- **A fix applied on one surface is not applied on the other.** The manifest
  handler renders the same session fields and takes the same filters as the
  session tools. `validatedFilter`'s own comment records that this handler had
  already once passed a bare string through to the silent widening it exists to
  prevent — and it had no test, so it could do it again.

The two smoke-only rows are the split working as intended rather than a gap:
whether an unconfigured directory is *named* as unconfigured is wiring, and
wiring is what the smoke suite spawns a real server to check.

The sweep also produced a lesson about sweeping. A first pass recorded a whole
batch as "killed" on nonzero exit codes while `node_modules` had been destroyed
and vitest was not running at all — the mutation harness was failing open in
precisely the way the mutations look for. A verdict now requires a parsed test
summary, not an exit code, and smoke mutations rebuild `dist/` first, because
the smoke suite spawns the built CLI and would otherwise test the previous
build.

### The append-scraper sweep

A third sweep on 2026-09-03 broke 45 load-bearing behaviours across the four
append-style scrapers — `claude-code.ts`, `codex.ts`, `copilot-cli.ts`,
`opencode.ts` — one line at a time, concentrating on the places where a defect
reaches a user silently: project attribution, resume cursors, role mapping,
message-index stability, timestamp handling, and the drift warnings that fire
on an unrecognised shape. The existing suite killed 25 and 20 survived. Thirteen
of those behaviours are now closed, each by a test verified to fail against the
exact mutation that survived it; five were left with reasons, recorded below.
Two are unaccounted for: 13 + 5 does not reach 20, and nothing in the
repository says which two they were. Treat the count as approximate rather
than as a ledger — the individual rows below are the part that was checked.

The survivors clustered in three places, and all three are the same shape: a
guard that only runs when a transcript says *nothing*.

- **The fail-closed defaults were untested.** Every existing boundary test
  gives its fixture a `cwd`, a `session.start` context, or a non-null
  `directory`, and then checks the right decision is made about it. That
  exercises the comparison and never the default. So `codex` serving a session
  whose `session_meta` carries no `cwd`, `copilot-cli` treating a
  `session.start` with no context as a match, and `opencode` admitting a
  session row whose `directory` is null all passed the whole suite. The
  opencode case could not have been caught: the existing fixture builder
  declares `directory TEXT NOT NULL`, so the row the filter exists for was
  unrepresentable.
- **Cursors could manufacture a decision nobody made.** `claude-code` writing
  `projectMatched: true` for a file it had actually refused let the next scan
  resume with the refusal overturned. This is the same defect
  `copilot-cli-resume-boundary.test.ts` already records for its scraper; the
  claude-code path had no equivalent.
- **A cursor recorded at the file's size rather than the boundary it read to**
  survived in both `claude-code` and `copilot-cli`. These files are appended to
  while being read, so the last line frequently has no newline yet;
  `readJsonlLines` stops short of it on purpose. Recording the size moves the
  next scan into the middle of that record, and it is never yielded — a
  permanent loss, one per interrupted append, with no signal.

Left, with reasons rather than tests:

| Survivor | Why it is not a gap |
|---|---|
| claude-code prefers `message.role` over the record's `type` | Real transcripts always agree between the two, so the mutation is unobservable on any shape the tool writes. A test would pin a preference, not a behaviour. |
| codex non-assistant `response_item` consumes an index | Skipped identically on a full and an incremental read, so index parity holds either way. Behaviourally equivalent. |
| codex drops the `break` on a `session_meta` mismatch | Still sets `projectMatched = false`, so the fail-closed gate refuses every later record and nothing leaks. Dropping the *assignment* instead — the documented bug — is killed. |
| copilot-cli `session.start` mismatch returns early | The `projectMatch !== true` guard below refuses every record anyway. The only observable difference is a misleading drift message. |
| opencode missing-`role` guard loses its `continue` | The type check immediately below skips the same record. Removing the guard outright, or both guards, is killed. |

The sweep also turned up one defect, which was a bug rather than a coverage
gap. **Fixed since, in c9beb48** — `readJsonlLines` now hands back a head
sample of a discarded line so the record can still be classified, and
`tests/scrapers/codex-oversized-records.test.ts` pins the warning. The
description below is kept because the shape of the defect is the lesson:
an oversized `codex` line was dropped with no drift warning at all, and the
code that was meant to warn could not run.
`readJsonlLines` already caps lines at `MAX_LINE_BYTES` and delivers anything
over it as `line: null`, discarding the bytes; `codex.ts` then `continue`s on
that branch in silence. The `isWithinLineLimit(line)` check below it — the one
that calls `isKnownBulkyRecord` so a benign `compacted` restatement is skipped
quietly while anything else is reported — is unreachable, because a line that
survived the reader is always within the limit. Measured directly: a 9MB
`response_item` between two ordinary records yields the ordinary records and
zero warnings. `claude-code.ts` and `copilot-cli.ts` both warn on the same
branch, so codex is the only one that goes quiet. Fixing it needs
`readJsonlLines` to hand back a head sample of a discarded line, since the
classification requires the record's `type` and the bytes are gone by then —
a shared-reader change, left for whoever owns that module.

Two lessons about sweeping, both cheap to repeat:

- **An equivalent mutation is not a gap, and telling them apart takes a second
  mutation.** Five of the twenty survivors were behaviourally equivalent —
  masked by a guard below, or symmetric across both read paths. Each was
  settled by sharpening the mutation rather than by writing a test, and one
  test was only kept because a sharpened mutation proved it was not vacuous.
- **`npm` on a developer machine may not be npm.** The shim on this one ignores
  the lockfile pin and resolves the newest version, which is how a sweep can
  end up scoring mutations against a test runner it never installed.

## Known and accepted

- **Ranking numbers are the eval's; ranking behaviour is not.** A weight is a
  quality decision swept against a corpus, so pinning 0.5 in a unit test would
  fight the next sweep — the eval owns the values, and you should still run
  `npm run test:eval` when touching `handoff/ranking.ts`.
  `tests/handoff/ranking-contract.test.ts` covers the separate question of
  whether the behaviour exists at all: corroboration helps, the tie-break only
  breaks ties, windows overlap, one session cannot fill the answer. Those
  assert shape rather than value, so a re-sweep passes and a deletion does not.
  Verified against four mutations that previously only the eval caught.
- **The embedding model is disabled in most of the suite.** Several vitest
  workers each loading a ~100MB ONNX model exhausted memory and produced
  failures in unrelated tests. `tests/setup.ts` sets
  `XTCTX_DISABLE_EMBEDDINGS=1`; search degrades to keyword without vectors, so
  a test not asserting embeddings loses nothing. The real provider is still
  exercised: `tests/handoff/embeddings.test.ts` builds it directly and runs in
  the default suite, and the eval embeds a whole corpus. The library is not a
  package dependency (it is the optional add-on `xtctx embeddings enable`
  installs), so those, the smoke test and the bake-off script set
  `XTCTX_EMBEDDING_RUNTIME_DIR` to the repository root, where it is a
  devDependency. `tests/handoff/embedding-runtime.test.ts` pins that nothing in
  `src/` imports it and that the install runs from the shipped lockfile (npm
  mocked); `tests/handoff/semantic-off.test.ts` covers search and status with
  semantic search off.
- **`toFtsQuery` escapes a quote that cannot reach it.** The term pattern does
  not admit `"`, so the escaping is unreachable belt-and-braces. Kept, and
  pinned by a test that says so, rather than removed.

## The literal search route

`mode: "literal"` reads the transcript stores instead of the index, which makes
it the one retrieval path that could widen the project boundary — a grep over a
store returns every project's conversations. It does not read files: it streams
what each scraper yields, attribution already applied, so the boundary is
enforced in one place rather than two. `tests/handoff/literal-search.test.ts`
opens on that case for exactly that reason.

Its budget is its own, not the refresh budget. Sharing them was a real bug
caught while writing these tests: `refreshBudgetMs: 0` means "do not wait for a
scan", and reusing it gave the literal pass no time at all, so it returned
nothing and called itself complete.

## Adding a test

Ask which layer would have caught the defect, not which is easiest to write.
Then break the code and confirm the new test goes red — a test that passes
against the bug it was written for is worse than no test, because it is
counted as coverage.
