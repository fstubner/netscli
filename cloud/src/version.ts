import pkg from "../package.json";

/** Reported in /health, the X-Xtctx-Server-Version header, and MCP serverInfo. */
export const SERVER_NAME = "xtctx-cloud";
export const SERVER_VERSION: string = pkg.version;
