# Cloud sync

Optional. xtctx stays local unless you do both of these:

1. **Log in:** `xtctx login` signs you in with GitHub and stores a token. It uploads nothing.
2. **Opt a project in:** `xtctx sync enable`, run in that project. Each project is its own decision.

Either one alone sends nothing. `XTCTX_TOKEN` in the environment counts as logging in, not as opting in.

## What is uploaded

For an opted-in project, the messages in **that project's own index** (`.xtctx/state/xtctx.db`): each message's text, role, timestamp, tool and session id, the git branch and commit, and a project identity. The identity is the normalised git remote (`github.com/you/repo`), or a hash of the folder's location when there is no remote. The project's folder name is sent; its absolute path is not.

Sessions that xtctx has not attributed to the project are never read. Nothing is written into your repository for sync.

The opt-in list is `~/.xtctx/cloud-projects.json` and the login is `~/.xtctx/credentials.json` (readable by you only). Both live in your home directory, not in `.xtctx/config.yaml`, so a repository cannot opt its readers in by committing a file.

## When it uploads

- While an agent runs xtctx in an opted-in project, the MCP server uploads what is new every 10 seconds, and once more when it shuts down. Nothing runs when no agent does: there is no daemon.
- `xtctx sync` uploads once. `xtctx sync --watch` keeps doing it in the foreground until you press Ctrl+C.

Uploads are incremental: a position is kept per account, so a message is sent once.

## Commands

| Command | What it does |
|---|---|
| `xtctx login` | Sign in with GitHub (device code). |
| `xtctx sync enable` / `disable` / `status` | Choose whether this project uploads. |
| `xtctx sync` | Upload now. `--watch` repeats every 10 seconds. |
| `xtctx logout` | Revoke every token for your account, then forget the local login. |
| `xtctx logout --delete-data` | Delete everything uploaded for your account first, then log out. |

`disable` stops further uploads but does not delete what was already sent; use `logout --delete-data` for that.

## Server

The service is the Worker in [`cloud/`](../cloud/README.md). The sync URL must be `https`; plain `http` is accepted only for `localhost`.
