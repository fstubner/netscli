# Cloud sync

Optional, and opt-in per project. xtctx stays local unless you do both of these:

1. **Log in:** `xtctx login` signs you in with GitHub and stores a token. It uploads nothing.
2. **Opt a project in:** `xtctx sync enable`, run in that project. Each project is its own decision.

Either one alone sends nothing. `XTCTX_TOKEN` in the environment counts as logging in, not as opting in.

What it is for: reading, from an agent on another machine, what your agents did here. The cloud serves the uploads back over MCP (see [Reading it back](#reading-it-back)).

## What is uploaded

For an opted-in project, only the sessions **that project's own index** (`.xtctx/state/xtctx.db`) attributes to that project, compared the way the index's own reads compare project roots. Sessions an index holds for another folder (a copied `.xtctx/`, a renamed folder) are not sent.

Per session:

- the tool (`claude-code`, `codex`, ...) and the tool's session id
- git branch and commit, when recorded
- first and last activity time
- the preview: the start of the session's first message, up to 160 characters

Per message:

- the message text, role, timestamp and position
- a content hash, and the index's own message id
- these metadata fields and no others: `messageIndex`, `tokenEstimate`, `toolCalls`, `toolName`, `model`, `stepType`, `artifactType`, `artifactName`, `sessionType`, `approvalMode`, `sandboxed`, `layer`, `costUsd`, `gitBranch`, `gitCommit`, `subagent`, `subagentType`. A value among them that looks like an absolute path is dropped.

Per upload:

- a project identity: the normalised git remote (`github.com/you/repo`), or a hash of the folder's location when there is no remote
- the project's folder name (not its path)
- this device's id (random, made at login) and its name, which is a random label like `device-3f9a1c` unless you set one
- the client version (`X-Xtctx-Client: xtctx/<version>`)

**Not uploaded:** the absolute path of the project or of any transcript file (the index's `source_pointer`, Antigravity's `sourcePath`), `referencedFiles`, Copilot CLI's `parentToolCallId`, your hostname, and any metadata field not listed above.

**Message text is uploaded as written**, and it can contain anything your agents saw or printed: file paths, command output, a secret pasted into a chat. Opt in only projects whose transcripts you would put on that server. A message over 64 KB is cut to 64 KB and ends with a `[xtctx: truncated for upload ...]` marker.

The opt-in list is `~/.xtctx/cloud-projects.json` and the login is `~/.xtctx/credentials.json` (readable by you only). Both live in your home directory, not in `.xtctx/config.yaml`, so a repository cannot opt its readers in by committing a file. Nothing is written into your repository for sync.

## When it uploads

- While an agent runs xtctx in an opted-in project, its MCP server uploads every 10 seconds, and once more when it shuts down. Nothing runs when no agent does: there is no daemon. With two agents open in one project, a lock in `~/.xtctx/sync/` lets one server upload at a time.
- `xtctx sync` uploads once, and exits non-zero if that failed. `xtctx sync --watch` repeats every 10 seconds in the foreground until Ctrl+C, and prints a repeated failure once.

Each session's cloud copy is kept equal to the local one. New and changed messages are sent under their local ids, and the server answers with how many messages it holds for the session. When that differs from the local count (a re-read here removed or replaced messages), the whole session is sent with its full list of ids and the server deletes the rest. Uploads are idempotent, so sending something twice changes nothing.

What has been sent is tracked per project and per account in `~/.xtctx/sync/`, not in the index, so logging in as someone else uploads the project to them in full. Rebuilding the index sends everything once more, which changes nothing in the cloud for the same reason. A failed upload is retried in full on the next run.

If the server refuses one message as too large, that message is skipped from then on and recorded, and the rest of the project keeps uploading. `xtctx sync status` lists skipped messages.

## Environment variables

`XTCTX_TOKEN` and `XTCTX_SYNC_URL` override the saved login. An MCP config's `env` block can set them, and a repository can ship such a config, so when they name anything other than your saved login (another token, another server, or no saved login at all) xtctx **refuses to upload** and says why. Set `XTCTX_ALLOW_ENV_CREDENTIALS=1` as well when that is intended, such as on a machine nobody logs in on. `XTCTX_DEVICE_ID` and `XTCTX_DEVICE_NAME` name the device for environment credentials.

## Commands

| Command | What it does |
|---|---|
| `xtctx login [--device <name>]` | Sign in with GitHub (device code). This login can read, upload and delete. |
| `xtctx sync enable` / `disable` | Choose whether this project uploads. |
| `xtctx sync status` | Whether this project uploads, as whom, the last upload, the last failure, and skipped messages. `xtctx status` shows the same under `Cloud`. |
| `xtctx sync` | Upload now. `--watch` repeats every 10 seconds. Exits non-zero on failure. |
| `xtctx sync device [<name>]` | Show or set the name this device uploads as. |
| `xtctx sync token` | Print a read-only token (valid 90 days) for an MCP client that cannot sign in by itself. |
| `xtctx logout` | Revoke every token and every client sign-in for your account, then forget the local login. |
| `xtctx logout --delete-data` | Delete everything uploaded for your account, then log out. If the server no longer accepts your login it deletes nothing and says so; run `xtctx login` and try again. |

`disable` stops further uploads but does not delete what was already sent; use `logout --delete-data` for that. Deleting also revokes every token issued before it, and they stay revoked when you sign in again.

## Reading it back

The server is an MCP server at `https://mcp.xtctx.com/mcp` with three tools, named so they cannot collide with the local server's when both are connected:

- `xtctx_cloud_status`: when each of your devices last uploaded each project, and how many sessions it holds. Tells "synced, nothing new" from "never synced".
- `xtctx_cloud_recent_sessions`: sessions from every device and every project, newest first; `repo_url` restricts it to one repository.
- `xtctx_cloud_session_detail`: one session's messages in order, as `markdown` (default) or `json`.

**MCP clients sign in with OAuth.** Add the URL to the client, for Claude Code `claude mcp add --transport http xtctx-cloud https://mcp.xtctx.com/mcp`, and it finds the sign-in itself, registers, and opens a browser where you approve it and sign in with GitHub. A client signed in this way can only read (scope `read`). Its access token lasts an hour and is refreshed for up to 30 days; it cannot upload or delete. Uploading and deleting need the CLI's own login.

A client without OAuth support can send a token from `xtctx sync token` as an `Authorization: Bearer ...` header. It is read-only as well, and `xtctx logout` revokes it.

## Server

The service is the Worker in [`cloud/`](../cloud/README.md), which also describes running your own. The sync URL must be `https`; plain `http` is accepted only for `localhost`. Only the GitHub accounts the server's operator lists can sign in.
