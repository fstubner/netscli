# xtctx-cloud

Cloudflare Edge continuous memory store and Model Context Protocol (MCP) server for `xtctx`.

## Features
- **Dual-Version MCP Server**: Supports both modern stateless **2026-07-28** specification (`POST /mcp`) and baseline **2024-11-05** SSE streaming (`GET /sse` + `POST /message`) for full compatibility across Cursor, Claude Desktop, Claude Code, and Antigravity.
- **Continuous Memory Store**: Powered by Cloudflare D1 (serverless SQLite) with millisecond multi-device ingestion.
- **GitHub Device Flow Auth**: Friction-free OAuth 2.1 authentication without needing local redirect ports.
- **RFC 9728 Discovery**: Exposes `/.well-known/oauth-protected-resource` for automated MCP client authorization.

---

## Deployment Quickstart

### 1. Install Dependencies
```bash
npm install
```

### 2. Create Cloudflare D1 Database
```bash
npx wrangler d1 create xtctx-db
```
Copy the generated `database_id` into `cloud/wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "xtctx-db"
database_id = "your-database-id-here"
```

### 3. Create the schema

A new database:
```bash
npm run d1:migrate:remote
```
That applies `schema.sql`, which already includes everything below.

A database created from an earlier `schema.sql` needs the files in `migrations/`, **in order, before you deploy the code that uses them**:
```bash
npx wrangler d1 execute xtctx-db --remote --file=./migrations/0001_token_version.sql
```
Run each once. For local testing use `--local` instead of `--remote`.

### 4. Configure GitHub OAuth App
1. Go to [GitHub Developer Settings](https://github.com/settings/developers) -> **OAuth Apps** -> **New OAuth App**.
2. Set Application Name to `xtctx`.
3. Set Homepage URL to `https://xtctx.com`.
4. Enable **Device Flow** checkbox in the OAuth App settings.
5. Put your `Client ID` in `wrangler.toml` under `GITHUB_CLIENT_ID`.

### 5. Set the JWT secret (required)
```bash
npx wrangler secret put JWT_SECRET
```
Use a long random value, for example `openssl rand -base64 48`. There is no default: **until it is set, every route except `/health` answers 500.** Changing it later signs everyone out.

### 6. Deploy to Cloudflare
```bash
npm run deploy
```

---

## Security notes

- Tokens are accepted from the `Authorization` header only, last 30 days, and are revoked by `POST /auth/logout` (all of an account's tokens) or `DELETE /api/me` (which also deletes the account's data).
- Browsers get no CORS headers unless their origin is listed in the `ALLOWED_ORIGINS` variable (comma-separated). The CLI and MCP clients do not need CORS.
- Errors return a generic body; the detail goes to the Worker's log.
- The baseline-MCP `/sse` streams live in the `SseSession` Durable Object, so `/message` works from any isolate.
- `npm test` runs the Worker's tests against an in-memory SQLite.

---

## Custom Domains (xtctx.com)
In your Cloudflare dashboard (or `wrangler.toml`), map:
- `mcp.xtctx.com` -> `xtctx-cloud` Worker (used by Cursor, Claude, Antigravity)
- `sync.xtctx.com` -> `xtctx-cloud` Worker (used by `xtctx login` and `xtctx sync`)

---

## Connecting Clients

### Authenticate CLI
```bash
xtctx login
```

### Choose what uploads
```bash
xtctx sync enable   # run in a project: opt it in
xtctx logout        # revoke tokens; add --delete-data to erase your uploads
```
See [`docs/cloud-sync.md`](../docs/cloud-sync.md) for what is sent and when.

### Configure Cursor (`.cursor/mcp.json`) or Claude Desktop
```json
{
  "mcpServers": {
    "xtctx-cloud": {
      "url": "https://mcp.xtctx.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_JWT_TOKEN"
      }
    }
  }
}
```
*(Note: If using modern clients supporting MCP 2026-07-28, you can also connect directly to `https://mcp.xtctx.com/mcp`)*
