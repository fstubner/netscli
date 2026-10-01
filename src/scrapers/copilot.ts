/**
 * Copilot Chat reader, split by seam:
 *
 * - `copilot/shared.ts`: the scraper name and the drift reporter both modules use
 * - `copilot/journal.ts`: rebuilding a session from a `.jsonl` mutation log
 * - `copilot/scraper.ts`: store discovery, and stored sessions to chunks
 *
 * The journal is its own module because it is its own job. It replays a
 * mutation log into a state object and guards the key paths in it against
 * prototype pollution; it knows nothing about chats, requests, roles or
 * chunks, and it would read the same if the file belonged to another tool.
 * The two halves also never change together — one moves when VS Code changes
 * its journal encoding, the other when Copilot changes its chat schema — and
 * the test suite already treats them as separate units
 * (`copilot-journal-safety.test.ts` drives `parseChatSessionFile` directly).
 *
 * This file is the public surface; it re-exports so that every existing
 * import path keeps working.
 */
export { CopilotScraper, ACCEPTED_DEGRADATIONS, COPILOT_SCRAPER_VERSION } from "./copilot/scraper.js";
export { parseChatSessionFile } from "./copilot/journal.js";
