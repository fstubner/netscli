# xtctx-cloud

The optional server behind [xtctx cloud sync](../docs/cloud-sync.md): a Cloudflare Worker that stores what opted-in projects upload (D1) and serves it back over MCP. Nothing reaches it unless a user logs in **and** opts a project in.

## What it serves

| Route | Who calls it | Auth |
|---|---|---|
| `POST /mcp` | MCP clients (Streamable HTTP; 2026-07-28 per-request, and 2025-11-25 / 2025-06-18 with `initialize`) | OAuth token with `read`, or one of this server's own tokens with `read` |
| `GET /sse`, `POST /message` | MCP clients on the deprecated 2024-11-05 SSE transport | this server's own token with `read` |
| `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource` | MCP clients, discovery | none |
| `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/token`, `/authorize`, `/oauth/github/callback` | MCP clients signing in | see below |
| `POST /auth/device/code`, `POST /auth/device/poll` | `xtctx login` (GitHub device flow) | none |
| `POST /api/stream` | uploads from `xtctx` | CLI token, `sync:write` |
| `POST /api/tokens` | `xtctx sync token` | CLI token, `sync:write` |
| `POST /auth/logout`, `DELETE /api/me` | `xtctx logout [--delete-data]` | CLI token (`account:delete` for the delete) |
| `GET /health` | anyone | none; reports the version, also sent as `X-Xtctx-Server-Version` on every response |

### Sign-in

The Worker is an OAuth 2.1 authorization server for its own MCP resource, `${PUBLIC_URL}/mcp`, built on Cloudflare's [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider). GitHub is only the identity step.

- **MCP clients** find it from the `401` on `/mcp` (whose `WWW-Authenticate` names the protected-resource metadata), register through a Client ID Metadata Document (MCP 2026-07-28) or dynamic registration (older clients), and send the user to `/authorize`. That page names the client and where the access goes, then hands off to GitHub's web flow; the callback checks the allowlist and finishes the grant. PKCE with S256 is required of every client. Tokens are bound to the `/mcp` resource, carry only `read`, last an hour, and refresh for 30 days.
- **The CLI** uses GitHub's device flow (`/auth/device/*`) and gets this server's own token (HS256, 30 days) with `read sync:write account:delete`, valid at `/mcp` and `/api/*`.
- **Pasted tokens** (`xtctx sync token`, `POST /api/tokens`) are this server's own tokens with `read` only, valid 90 days at `/mcp` and `/sse`, for clients that cannot sign in by themselves.

Only GitHub accounts listed in `ALLOWED_GITHUB_IDS` can sign in, by either route. An empty list lets nobody in. Taking someone off the list ends their access at their next request; they can still log out and delete their data.

`POST /auth/logout` and `DELETE /api/me` move the account's token epoch, which every token carries and every request checks, and revoke its OAuth grants. The epoch is kept when the account's data is deleted, so a token from before a deletion stays dead after the same GitHub account signs in again.

### Uploads

`POST /api/stream` takes `{ device, project, sessions: [{ ..., messages, keepIds? }] }` and writes it as **one D1 batch**: all of it or none. Messages are keyed by the client's own ids, so a replay rewrites the same rows; `message_count` is recounted from the rows; `keepIds`, when sent, deletes every other stored message of that session. Limits, each answered with a JSON error the client acts on:

| Limit | Value | Over it |
|---|---|---|
| body | 1 MiB | `413 body_too_large` |
| one message's text | 64 KiB (UTF-8) | `413 message_too_large` naming the session and message; the client skips that message |
| one message's metadata | 4 KiB | the same |
| sessions per request | 10 | `400` |
| messages per request | 500 | `400` |
| the pre-0.2 upload format | | `426 client_outdated` |

These keep a request inside D1's limits: messages go in as one JSON parameter per session, and a request makes at most 4 statements per session plus 2 in its batch, and 2 reads around it: 44 queries for 10 sessions, under the free plan's 50 per invocation. A failed write is logged as `{"event":"ingest_failed","userId",...,"bytes","sessions","messages","error"}`, never with content.

## Deploying

In this order. Nothing here is run by the tests or by CI.

### 1. Install

```bash
cd cloud
npm install
```

### 2. D1 database

New deployment only: `npx wrangler d1 create xtctx-db`, then put the printed `database_id` in `wrangler.toml`.

### 3. KV namespace for OAuth

```bash
npx wrangler kv namespace create OAUTH_KV
```

Put the printed id in `wrangler.toml` under `[[kv_namespaces]]`, replacing `REPLACE_WITH_OAUTH_KV_NAMESPACE_ID`, which is not a namespace.

### 4. Schema

```bash
npm run d1:migrate:remote      # wrangler d1 migrations apply xtctx-db --remote
```

Migrations live in `migrations/` and `wrangler` records which ran in the database's `d1_migrations` table. Apply them **before** deploying code that needs them. `0000_baseline.sql` is the schema as it was when tracking started; `0001_sync_v2.sql` adds the token epochs and the upload status table, and drops the columns that held absolute paths.

#### A database created before tracked migrations

A database made from the old `schema.sql` (with or without the old `0001_token_version.sql`) is brought onto the tracked path without losing data:

1. Check that `users` has the `token_version` column:
   ```bash
   npx wrangler d1 execute xtctx-db --remote --command "SELECT name FROM pragma_table_info('users') WHERE name = 'token_version'"
   ```
   If that returns no row, add it first (this was the old `0001_token_version.sql`):
   ```bash
   npx wrangler d1 execute xtctx-db --remote --command "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"
   ```
2. Run `npm run d1:migrate:remote`. It applies `0000_baseline.sql`, which is all `CREATE ... IF NOT EXISTS` and so changes nothing on this database, then `0001_sync_v2.sql`, which copies each user's `token_version` into `token_epochs` (nobody is signed out by the copy) and drops `users.token_version`, `sessions.status`, `sessions.source_path` and `messages.source_pointer`.

Existing rows stay. Messages uploaded by clients before 0.2 have ids in the old scheme; the first sync from each device after it updates replaces them, because the session counts differ and the client then sends the session whole with its ids.

### 5. GitHub OAuth app

At [GitHub Developer Settings](https://github.com/settings/developers) → OAuth Apps, on the app whose client id is `GITHUB_CLIENT_ID` in `wrangler.toml`:

1. Enable **Device Flow** (for `xtctx login`).
2. Set the **Authorization callback URL** to `https://mcp.xtctx.com/oauth/github/callback`, that is `PUBLIC_URL` + `/oauth/github/callback`.
3. Generate a client secret for the next step.

### 6. Secrets and variables

```bash
npx wrangler secret put JWT_SECRET            # required; e.g. openssl rand -base64 48
npx wrangler secret put GITHUB_CLIENT_SECRET  # the OAuth app's secret, for browser sign-in
```

- Until `JWT_SECRET` is set every route except `/health` answers 500. Changing it later invalidates every CLI and pasted token.
- Without `GITHUB_CLIENT_SECRET` the CLI's device flow still works and `/authorize` answers 503.
- Set `ALLOWED_GITHUB_IDS` in `wrangler.toml` `[vars]` to the comma-separated numeric GitHub ids allowed to sign in (yours is `"id"` in `https://api.github.com/users/<login>`). It ships empty, which lets nobody in.
- `PUBLIC_URL` (in `wrangler.toml`) is the origin MCP clients connect to; tokens are bound to `PUBLIC_URL/mcp`, so it must match the domain clients use.
- `ALLOWED_ORIGINS` (optional, comma-separated) is the only way a browser origin gets CORS headers, and the only foreign `Origin` `/mcp` accepts.

### 7. Deploy

```bash
npm run deploy
```

The Worker is served only on its custom domains (`workers_dev = false`): `mcp.xtctx.com` for MCP clients and `sync.xtctx.com` for the CLI. Logs and traces go to Workers Observability (`[observability]`).

After a deploy, CLI users of a version before 0.2 get `426` on upload and must update xtctx, and tokens from before this version (they carry no scopes) are refused, so everyone runs `xtctx login` once.

## Running it locally

```bash
cd cloud
node node_modules/wrangler/bin/wrangler.js d1 migrations apply xtctx-db --local --persist-to <short dir>
node node_modules/wrangler/bin/wrangler.js dev --local --port 8787 \
  --local-upstream localhost:8787 --upstream-protocol http --persist-to <short dir> \
  --var PUBLIC_URL:http://localhost:8787 --var JWT_SECRET:<anything> \
  --var GITHUB_CLIENT_SECRET:<a local OAuth app's secret> --var ALLOWED_GITHUB_IDS:<your id>
```

- `--local-upstream` and `--upstream-protocol`: without them `wrangler dev` presents requests as `https://mcp.xtctx.com/...` (the first route), so the resource metadata and challenge do not match `http://localhost:8787` and MCP clients cannot discover the sign-in.
- On Windows keep `--persist-to` short (`C:\tmp\xw`, say); a long path runs past `MAX_PATH` and D1 commands fail.
- The browser sign-in needs a GitHub OAuth app whose callback is `http://localhost:8787/oauth/github/callback`; a GitHub OAuth app has one callback URL, so use a separate app for local work.
- Point the CLI at it with `xtctx login --sync-url http://localhost:8787` (plain `http` is accepted only for `localhost`).

## Tests

`npm test` runs the Worker in Node against an in-memory SQLite D1 (built from `migrations/`, in order) and an in-memory KV, with GitHub stubbed: uploads, revocation, tenant isolation, the MCP protocol for both eras, and the whole OAuth flow from registration to a token used at `/mcp`. `npm run typecheck` checks the Worker's sources.
