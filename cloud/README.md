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

### 3. Run Schema Migrations
For local testing:
```bash
npm run d1:migrate:local
```
For production:
```bash
npm run d1:migrate:remote
```

### 4. Configure GitHub OAuth App
1. Go to [GitHub Developer Settings](https://github.com/settings/developers) -> **OAuth Apps** -> **New OAuth App**.
2. Set Application Name to `xtctx`.
3. Set Homepage URL to `https://xtctx.com`.
4. Enable **Device Flow** checkbox in the OAuth App settings.
5. Put your `Client ID` in `wrangler.toml` under `GITHUB_CLIENT_ID`.

### 5. Set JWT Secret
```bash
npx wrangler secret put JWT_SECRET
```
*(Enter any secure random string)*

### 6. Deploy to Cloudflare
```bash
npm run deploy
```

---

## Custom Domains (xtctx.com)
In your Cloudflare dashboard (or `wrangler.toml`), map:
- `mcp.xtctx.com` -> `xtctx-cloud` Worker (used by Cursor, Claude, Antigravity)
- `sync.xtctx.com` -> `xtctx-cloud` Worker (used by `xtctx watch` and `xtctx login`)

---

## Connecting Clients

### Authenticate CLI
```bash
xtctx login
```

### Start Real-Time Watcher
```bash
xtctx watch
```

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
