# Keeping the index: backup, moving machines, restore

Status: option 1 built, with these answers to the open questions: per
project; no vectors; plain JSON Lines rather than gzipped, so a backup can be
read without xtctx (format in `src/handoff/export-file.ts`). Snapshots
(option 2) not built. Alongside it, schema upgrades now migrate the index in
place instead of setting it aside, a set-aside index has the sessions only it
held copied into the rebuilt one, and `xtctx status` counts the sessions that
exist only in the index. The rest of this page is the proposal as written.

## Why this matters now

The index was documented as "a rebuildable cache". That is true only while every
transcript it was built from still exists, and they do not all survive:

- xtctx never deletes a session whose transcript file has gone. The only code
  that deletes messages works on sessions re-read in the current scan
  (`pruneRereadSessions` in `src/handoff/scan.ts`).
- Agents clean up their own transcripts. Claude Code deletes sessions older than
  `cleanupPeriodDays`, 30 days by default
  (<https://code.claude.com/docs/en/data-usage>).

So after a month, the index is the only copy of older Claude Code sessions. Two
things deleted it anyway, and both are fixed on `fix/cli-ux`:

- `xtctx setup --repair` removed `.xtctx/state/`, and `xtctx status` told anyone
  with a drifted skill copy to run it. Repair now keeps the index; status points
  at plain `setup --yes`.
- An index that failed to open, including every schema version change, was
  deleted and rebuilt. It is now moved to `xtctx.db.set-aside-<time>` instead.

What is still missing is a way to copy the history out: for a backup, for a new
machine, or to get back to an earlier state.

## What is worth keeping

Measured on this repository's index, 2026-09-26:

| Table | Size | Rebuildable from |
| --- | --- | --- |
| `retrieval_units` + FTS | 92 MB | `messages` |
| `messages` | 28.5 MB | the transcripts, while they exist |
| `retrieval_unit_vectors` | 8.8 MB | `retrieval_units`, by re-embedding |
| whole file | 136 MB | |

17,176 messages across 56 sessions. Only `sessions` and `messages` hold anything
that cannot be recomputed; they are about a fifth of the file.

## Options

1. **`xtctx export` / `xtctx import`.** Export writes this project's `sessions`
   and `messages` to one file (JSON Lines, gzipped). Import merges it into an
   index with `INSERT OR IGNORE`, so importing twice or into an index that
   already has some of the sessions is safe. Windows, FTS and vectors are rebuilt
   after import. Covers backup and moving machines; restore to a point in time is
   "import the export from then".
2. **Automatic snapshots.** The MCP server, at most once a day, writes a copy of
   `sessions` and `messages` to `.xtctx/backups/`, keeping the last N. No command
   to remember; costs disk (around 28 MB a snapshot here before compression) and
   a little start-up work.
3. **Both.** Snapshots as the safety net, export/import for moving machines.

Moving machines has one limit whatever is chosen: a session's `source_path`
points at a file on the old machine. Reading history works; "open the original
transcript" does not.

## Recommendation

Option 1 first. It is explicit, has no background cost, and covers all three
uses. Add snapshots (option 2) only if export turns out to be something people
forget to run, which is the usual fate of manual backups.

## Open questions

1. Export per project (the default above) or everything in the index?
2. Should export include vectors? They are 8.8 MB here and save re-embedding
   4,271 windows on import, but they are tied to the embedding model and
   device, and useless on a machine configured differently.
3. Is option 2 wanted from the start, and if so how many snapshots?
