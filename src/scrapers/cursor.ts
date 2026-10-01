import { readdir, stat } from "node:fs/promises";
import { classifyWorkspace, workspaceMatchesProject } from "./vscode-workspace.js";
import { basename, join } from "node:path";
import type Database from "better-sqlite3";
import { glob } from "glob";
import type { CursorChunk } from "../types/scraper.js";
import { AbstractScraper, describeType, driftWarner, estimateTokens, isRecord, toDate } from "./base.js";
import { pathMatchesProject } from "../utils/project-scope.js";
import { withDriftReport } from "./drift-log.js";

// Bubble type constants from Cursor's internal format.
const BUBBLE_TYPE_USER = 1;
const BUBBLE_TYPE_ASSISTANT = 2;

const SCRAPER_NAME = "cursor";
const STATE_DB_NAME = "state.vscdb";

/**
 * Bumped when the scraper's output for a conversation it has already read
 * changes, so that already-indexed rows are corrected rather than kept.
 *
 * 1 (absent from state): text bubbles only; every conversation placed by the
 *    files it recorded; a subagent's prompt indexed as the user's.
 * 2: tool-call bubbles leave a 'tool' line; conversations are placed by
 *    `composerHeaders`; a subagent's prompt is role 'tool'.
 *
 * The cursor sits past every conversation already read, so without this the
 * old rows stay as they were until a conversation happens to grow. A stored
 * version below this resets the cutoff for one scan, which re-reads every
 * conversation still in the store through the normal path; the index's
 * re-read prune then replaces the old rows of each. Conversations that have
 * left the store are not re-read, so their rows keep the old shape: they are
 * the only copy, which is why this corrects in place instead of rebuilding.
 */
export const CURSOR_SCRAPER_VERSION = 2;

/**
 * Shapes the cursor scraper tolerates silently without logging. All other
 * shape surprises warn; missing required tables throw.
 */
export const ACCEPTED_DEGRADATIONS = {
  /** Store path missing — Cursor not installed on this machine. */
  missingStorePath: "cursor workspaceStorage path absent",
  /** Workspace has no composerData yet — empty workspace. */
  emptyWorkspace: "workspace has no composer.composerData row",
  /** A composer whose bubble row is missing — bubble pruned by Cursor. */
  prunedBubble: "bubble referenced by composer but missing from globalStorage",
  /** Empty bubble text with no tool call either — a thinking bubble, kept out on purpose. */
  emptyBubbleText: "bubble has no user-visible text",
  /** Forward-compat unknown keys alongside known composer fields. */
  unknownFieldsAlongside: "extra keys alongside known composer schema",
};

const warnDrift = driftWarner(SCRAPER_NAME);

/**
 * The `composerHeaders` columns the scraper reads. The committed format
 * fingerprint (`tests/drift/fingerprints/cursor.json`) has to list each, so a
 * column the scraper starts depending on cannot go unwatched.
 */
export const COMPOSER_HEADER_COLUMNS = [
  "composerId",
  "workspaceId",
  "isSubagent",
  "subagentTypeName",
] as const;

interface WorkspaceComposerRef {
  composerId: string;
  unifiedMode?: string;
  forceMode?: string;
}

/**
 * What globalStorage's `composerHeaders` table records about one conversation.
 *
 * Cursor moved the per-workspace conversation lists out of `workspaceStorage`
 * (`hasMigratedComposerData: true`, no `allComposers`) into this table, which
 * is the only place that still says which workspace a conversation belongs to.
 */
interface ComposerHeader {
  workspaceId?: string;
  /** A conversation a parent agent started; `subagentType` names its kind. */
  isSubagent: boolean;
  subagentType?: string;
}

/**
 * Whose a conversation is, according to its header: `ours` and `other` are the
 * header's workspace resolving to this project or to a different one, and
 * `unknown` is a header whose workspace cannot be resolved to a folder.
 */
type Attribution = "ours" | "other" | "unknown";

interface CursorComposerData {
  composerId: string;
  fullConversationHeadersOnly?: Array<{ bubbleId: string; type: number }>;
  createdAt?: number;
  lastUpdatedAt?: number;
  modelConfig?: { modelName?: string };
  unifiedMode?: string;
  forceMode?: string;
}

interface CursorBubbleData {
  type: number;
  text?: string;
  /** Present on a tool-call bubble, which carries no text of its own. */
  toolFormerData?: { name?: unknown; params?: unknown; rawArgs?: unknown };
  createdAt?: string | number;
  modelInfo?: { modelName?: string };
}

export class CursorScraper extends AbstractScraper<CursorChunk> {
  readonly tool = SCRAPER_NAME;

  constructor(
    private readonly cursorStorePath: string,
    stateDir: string,
    private readonly projectRoot?: string,
  ) {
    super(stateDir);
  }

  /**
   * Is Cursor installed with a store here — nothing about this project.
   *
   * This used to answer via `resolveWorkspaceDatabasePaths()`, which opens
   * every workspace to test project membership: 3.2s per call on a real
   * machine, paid on every `getStatus()`, which runs detection for all seven
   * scrapers. It also made `status` report "not detected" for an installed
   * Cursor that simply had no sessions for this project, which is not what
   * detection means for any of the other six scrapers.
   *
   * Stops at the first store found rather than enumerating them all.
   */
  async detect(): Promise<boolean> {
    let target;
    try {
      target = await stat(this.cursorStorePath);
    } catch {
      return false;
    }

    if (target.isFile()) {
      return true;
    }
    if (!target.isDirectory()) {
      return false;
    }

    let entries;
    try {
      entries = await readdir(this.cursorStorePath, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name === STATE_DB_NAME) {
        return true;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      if (await pathExists(join(this.cursorStorePath, entry.name, STATE_DB_NAME))) {
        return true;
      }
    }

    return false;
  }

  getStorePaths(): string[] {
    return [this.cursorStorePath];
  }

  async *scrape(since?: Date): AsyncIterable<CursorChunk> {
    const state = await this.getLastScrapedPosition();
    const outdated = since === undefined && (state.scraperVersion ?? 1) < CURSOR_SCRAPER_VERSION;
    const cutoff = since ?? (outdated ? new Date(0) : state.lastTimestamp);
    yield* withDriftReport(SCRAPER_NAME, this.readAllMessages(cutoff, outdated), this.stateDir);
  }

  async *fullSync(): AsyncIterable<CursorChunk> {
    yield* withDriftReport(SCRAPER_NAME, this.readAllMessages(new Date(0)), this.stateDir);
  }

  private async *readAllMessages(since: Date, recordVersion = false): AsyncIterable<CursorChunk> {
    // Dynamic import keeps better-sqlite3 an optional runtime dependency,
    // matching the copilot and opencode scrapers.
    let DatabaseCtor: typeof Database;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      DatabaseCtor = ((await import("better-sqlite3")) as any).default as typeof Database;
    } catch {
      // Native module unavailable — treat the source as absent.
      return;
    }

    const workspacePaths = await this.resolveWorkspaceDatabasePaths();
    const seenComposerIds = new Set<string>();

    // Read once, before anything is attributed: the header is the authority on
    // which workspace a conversation belongs to, and the workspace's own list
    // of conversations is no longer written by current Cursor.
    const globalPath = globalStoragePathForStore(this.cursorStorePath);
    const headers = this.readComposerHeaders(DatabaseCtor, globalPath);
    const attribution =
      headers && this.projectRoot
        ? await this.attributeByHeader(headers, this.projectRoot)
        : new Map<string, Attribution>();

    for (const wsPath of workspacePaths) {
      // A workspace that lists a conversation the header files under another
      // project is out of date about it; the header wins.
      const composerRefs = this.readWorkspaceComposers(DatabaseCtor, wsPath).filter(
        (ref) => attribution.get(ref.composerId) !== "other",
      );
      for (const ref of composerRefs) {
        seenComposerIds.add(ref.composerId);
      }
      if (composerRefs.length === 0) {
        continue;
      }

      const wsGlobalPath = deriveGlobalStoragePath(wsPath);
      if (!wsGlobalPath) {
        continue;
      }

      let globalDb: Database.Database | null = null;
      try {
        globalDb = new DatabaseCtor(wsGlobalPath, { readonly: true, fileMustExist: true });
        yield* this.readComposerMessages(globalDb, composerRefs, since, wsPath, headers);
      } catch (err) {
        // Global storage unreadable — treat as schema drift and warn.
        // The cursorDiskKV table is required; if it's gone, something changed.
        warnDrift(
          wsGlobalPath,
          `globalStorage unreadable: ${(err as Error).message}`,
        );
      } finally {
        globalDb?.close();
      }
    }

    // From the store path, not from a workspace that happened to match. Basing
    // it on a matched workspace meant a pruned workspaceStorage entry, or a
    // multi-root workspace with no `folder`, left this doing nothing at all —
    // while globalStorage sat exactly where it always sits.
    yield* this.readUnlistedComposers(
      DatabaseCtor,
      globalPath,
      seenComposerIds,
      headers,
      attribution,
      since,
    );

    // Reached only when the read ran to the end: a scan that throws abandons
    // the generator before this line, so an interrupted re-read does not mark
    // itself done. Nor does one that could not open globalStorage, which
    // reports drift and carries on rather than throwing, but has re-read
    // nothing.
    if (recordVersion && globalPath && canOpen(DatabaseCtor, globalPath)) {
      await this.saveScrapedPosition({ scraperVersion: CURSOR_SCRAPER_VERSION });
    }
  }

  /**
   * Every conversation globalStorage files under a workspace, keyed by id.
   *
   * `null` when the table is not there, which is what older Cursor looks like
   * and also what a rename would look like, so it is reported rather than
   * assumed. Columns are looked up first and only the ones present are
   * selected: a missing column then costs that piece of information, not the
   * whole table.
   */
  private readComposerHeaders(
    DatabaseCtor: typeof Database,
    globalPath: string | null,
  ): Map<string, ComposerHeader> | null {
    if (!globalPath) {
      return null;
    }

    let db: Database.Database;
    try {
      db = new DatabaseCtor(globalPath, { readonly: true, fileMustExist: true });
    } catch {
      // Unopenable globalStorage is reported where the conversations are read.
      return null;
    }

    try {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(composerHeaders)").all() as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      );
      if (columns.size === 0) {
        warnDrift(
          globalPath,
          "composerHeaders table is missing — conversations are attributed by the files they record",
        );
        return null;
      }
      if (!columns.has("composerId")) {
        warnDrift(globalPath, "composerHeaders has no 'composerId' column — cannot be used");
        return null;
      }
      if (!columns.has("workspaceId")) {
        warnDrift(
          globalPath,
          "composerHeaders has no 'workspaceId' column — conversations are attributed by the files they record",
        );
      }

      const selected = COMPOSER_HEADER_COLUMNS.filter((column) => columns.has(column));
      const rows = db
        .prepare(`SELECT ${selected.map((column) => `"${column}"`).join(", ")} FROM composerHeaders`)
        .all() as Array<Record<string, unknown>>;

      const headers = new Map<string, ComposerHeader>();
      for (const row of rows) {
        const composerId = toNonEmptyString(row.composerId);
        if (!composerId) continue;
        const subagentType = toNonEmptyString(row.subagentTypeName);
        headers.set(composerId, {
          workspaceId: toNonEmptyString(row.workspaceId),
          // The flag is stored as a number or a boolean depending on how
          // Cursor wrote it; either way a named subagent type says it too.
          isSubagent: isTruthyFlag(row.isSubagent) || subagentType !== undefined,
          subagentType,
        });
      }
      return headers;
    } catch (err) {
      warnDrift(globalPath, `composerHeaders unreadable: ${(err as Error).message}`);
      return null;
    } finally {
      db.close();
    }
  }

  /**
   * Settle each header against this project through the workspace it names.
   *
   * The workspace id is the directory under `workspaceStorage`, so the folder
   * comes from the `workspace.json` already used to scope workspaces. A
   * workspace that is plainly another project's makes the conversation
   * `other`; one that cannot be resolved (no id, directory pruned, a
   * multi-root workspace with no folder) makes it `unknown`, which falls back
   * to the files the conversation recorded rather than discarding it.
   */
  private async attributeByHeader(
    headers: Map<string, ComposerHeader>,
    projectRoot: string,
  ): Promise<Map<string, Attribution>> {
    const workspaceStorageDir = workspaceStorageDirForStore(this.cursorStorePath);
    const byWorkspace = new Map<string, Attribution>();
    const result = new Map<string, Attribution>();

    for (const [composerId, header] of headers) {
      const id = header.workspaceId;
      let verdict: Attribution = "unknown";
      // The id is joined into a path, so only a bare directory name is used.
      if (id && workspaceStorageDir && id === basename(id) && id !== "." && id !== "..") {
        let known = byWorkspace.get(id);
        if (!known) {
          const ownership = await classifyWorkspace(
            join(workspaceStorageDir, id, STATE_DB_NAME),
            projectRoot,
          );
          known = ownership === "match" ? "ours" : ownership === "other" ? "other" : "unknown";
          byWorkspace.set(id, known);
        }
        verdict = known;
      }
      result.set(composerId, verdict);
    }
    return result;
  }

  /**
   * Read conversations that no matched workspace lists.
   *
   * A workspace only keeps a composer in `composer.composerData` for as long as
   * it cares to — current Cursor keeps none — while globalStorage keeps the
   * conversation. On one machine that was 165 referenced against 593 stored,
   * so discovery through workspaces alone could not reach most of the history
   * that exists.
   *
   * Which workspace a conversation belongs to is read from `composerHeaders`
   * wherever it says. Only a conversation it cannot place — no header row, or a
   * workspace that resolves to no folder — is attributed by file paths
   * recorded inside it, which is deliberately strict: matching on any mention
   * of a project's name is what once handed one project another project's
   * private transcripts, and a conversation that cannot be placed is skipped
   * rather than guessed at. Path-guessing everything misfiled 3 of 100 real
   * conversations under a second project, which is why the header comes first.
   */
  private async *readUnlistedComposers(
    DatabaseCtor: typeof Database,
    globalPath: string | null,
    referenced: Set<string>,
    headers: Map<string, ComposerHeader> | null,
    attribution: Map<string, Attribution>,
    since: Date,
  ): AsyncIterable<CursorChunk> {
    // Without a project root there is nothing to attribute against, and an
    // orphan's only claim to belong anywhere is a header or a path match.
    // Reading them unscoped would mean every conversation on the machine,
    // which is the opposite of what an unscoped reader should do with
    // unattributable data.
    if (!globalPath || !this.projectRoot) {
      return;
    }

    let globalDb: Database.Database | null = null;
    try {
      globalDb = new DatabaseCtor(globalPath, { readonly: true, fileMustExist: true });
    } catch {
      // Already reported per-workspace above; not worth a second warning.
      globalDb?.close();
      return;
    }

    try {
      const getComposer = globalDb.prepare("SELECT value FROM cursorDiskKV WHERE key = ?");
      // Header-attributed to this project: no path check, and read from the
      // cursor like any listed conversation. Path-attributed ones are, by
      // definition, ones nothing lists, so they are older than the cursor.
      const attributed: WorkspaceComposerRef[] = [];
      const guessed: WorkspaceComposerRef[] = [];

      for (const candidate of this.unlistedCandidates(globalDb, headers, attribution)) {
        const composerId = candidate.composerId;
        if (!composerId || referenced.has(composerId)) {
          continue;
        }
        const verdict = attribution.get(composerId);
        if (verdict === "other") {
          continue;
        }

        const value =
          candidate.value ??
          (getComposer.get(`composerData:${composerId}`) as { value: string } | undefined)?.value;
        if (value === undefined) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(value) as unknown;
        } catch {
          // A malformed orphan is reported by readComposerMessages if it is
          // ever selected; here it simply cannot be attributed.
          continue;
        }

        // Some rows hold a literal `null`, which parses cleanly and then
        // throws on the first property access — enough to take down the whole
        // scan, including every workspace-referenced conversation.
        if (!isRecord(parsed)) {
          continue;
        }
        const composer = parsed as unknown as CursorComposerData;

        // Most orphans are abandoned chats with no turns at all — 405 of 504
        // on the machine this was measured on. Skipping them before the path
        // walk keeps the common case cheap.
        const turns = composer.fullConversationHeadersOnly;
        if (!Array.isArray(turns) || turns.length === 0) {
          continue;
        }

        const ref = { composerId, unifiedMode: composer.unifiedMode };
        if (verdict === "ours") {
          attributed.push(ref);
        } else if (composerMentionsProject(composer, this.projectRoot)) {
          guessed.push(ref);
        }
      }

      if (attributed.length > 0) {
        yield* this.readComposerMessages(globalDb, attributed, since, globalPath, headers);
      }
      if (guessed.length > 0) {
        // Deliberately not `since`: these are conversations no workspace
        // lists, so filtering them by the cursor meant the whole feature fired
        // only on a never-indexed project and did nothing for anyone with an
        // existing index. The copilot reader made the same call for the same
        // reason. Re-emitting is safe: upserts collapse on a chunk id that
        // includes the message index, so a conversation read twice is stored
        // once.
        yield* this.readComposerMessages(globalDb, guessed, new Date(0), globalPath, headers);
      }
    } catch (err) {
      // The same condition the workspace loop treats as drift and continues
      // past. Without this it escaped the scraper instead, which the index
      // records as a scrape error for the whole tool — so one unreadable
      // globalStorage lost every workspace-referenced conversation too, and
      // left `last_error` set in `status` until something cleared it.
      warnDrift(
        globalPath,
        `globalStorage unreadable while looking for unlisted conversations: ${(err as Error).message}`,
      );
    } finally {
      globalDb.close();
    }
  }

  /**
   * The conversations worth looking at for this project.
   *
   * With the header table that is a lookup by id: the ones it files under this
   * project, the ones whose workspace it cannot resolve, and any composer it
   * has no row for (found from the keys alone, which never touches the large
   * values). Without the table there is no id to start from, so every stored
   * composer is narrowed in SQL by the project's directory name. Walking them
   * all took a scan from 1.3s to 6.2s on a real store, and the same query is
   * what cost 9 to 28s a scan on a 6.9GB one — which is why it is only the
   * fallback. The name survives every encoding these blobs use (Windows paths,
   * `file:///` URIs), so it is a safe coarse filter; `composerMentionsProject`
   * still decides, and a name like `core` merely lets more candidates through
   * rather than admitting them.
   */
  private *unlistedCandidates(
    globalDb: Database.Database,
    headers: Map<string, ComposerHeader> | null,
    attribution: Map<string, Attribution>,
  ): Iterable<{ composerId: string; value?: string }> {
    if (!headers) {
      const rows = globalDb
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND value LIKE ?")
        .all(`%${basename(this.projectRoot ?? "")}%`) as Array<{ key: string; value: string }>;
      for (const row of rows) {
        yield { composerId: row.key.slice("composerData:".length), value: row.value };
      }
      return;
    }

    for (const [composerId, verdict] of attribution) {
      if (verdict !== "other") {
        yield { composerId };
      }
    }

    // A range over the key, not LIKE: the range uses the key's index and
    // reads no values, where LIKE on this column cannot.
    const keys = globalDb
      .prepare("SELECT key FROM cursorDiskKV WHERE key >= 'composerData:' AND key < 'composerData;'")
      .all() as Array<{ key: string }>;
    for (const { key } of keys) {
      const composerId = key.slice("composerData:".length);
      if (!headers.has(composerId)) {
        yield { composerId };
      }
    }
  }

  private readWorkspaceComposers(
    DatabaseCtor: typeof Database,
    wsDbPath: string,
  ): WorkspaceComposerRef[] {
    let db: Database.Database | null = null;

    try {
      db = new DatabaseCtor(wsDbPath, { readonly: true, fileMustExist: true });
    } catch {
      // File missing / unopenable — treat as absent workspace, not drift.
      return [];
    }

    try {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'")
        .get() as { value: string } | undefined;

      if (!row) {
        // ACCEPTED_DEGRADATIONS.emptyWorkspace
        return [];
      }

      let data: { allComposers?: WorkspaceComposerRef[] };
      try {
        data = JSON.parse(row.value) as { allComposers?: WorkspaceComposerRef[] };
      } catch (err) {
        warnDrift(
          wsDbPath,
          `composer.composerData value is not valid JSON: ${(err as Error).message}`,
        );
        return [];
      }

      if (data.allComposers !== undefined && !Array.isArray(data.allComposers)) {
        warnDrift(
          wsDbPath,
          `expected 'allComposers' to be an array, got ${describeType(data.allComposers)}`,
        );
        return [];
      }

      return data.allComposers ?? [];
    } catch (err) {
      // The ItemTable is a required workspace-storage contract — the db
      // opened but a query against it failed, meaning Cursor's internal
      // format changed. Warn loudly, but do not abort the remaining
      // workspaces over one broken database.
      warnDrift(wsDbPath, `ItemTable unreadable: ${(err as Error).message}`);
      return [];
    } finally {
      db?.close();
    }
  }

  private *readComposerMessages(
    globalDb: Database.Database,
    composerRefs: WorkspaceComposerRef[],
    since: Date,
    wsPathForWarn: string,
    composerHeaders: Map<string, ComposerHeader> | null,
  ): Iterable<CursorChunk> {
    const getComposer = globalDb.prepare(
      "SELECT value FROM cursorDiskKV WHERE key = ?",
    );
    const getBubble = globalDb.prepare(
      "SELECT value FROM cursorDiskKV WHERE key = ?",
    );

    for (const ref of composerRefs) {
      const composerRow = getComposer.get(
        `composerData:${ref.composerId}`,
      ) as { value: string } | undefined;

      if (!composerRow) {
        warnDrift(
          `${wsPathForWarn}#composerData:${ref.composerId}`,
          "workspace references a composer that is missing from globalStorage",
        );
        continue;
      }

      let composer: CursorComposerData;
      try {
        composer = JSON.parse(composerRow.value) as CursorComposerData;
      } catch (err) {
        warnDrift(
          `${wsPathForWarn}#composerData:${ref.composerId}`,
          `composer JSON not parseable: ${(err as Error).message}`,
        );
        continue;
      }

      // Strict-mode schema check: 'fullConversationHeadersOnly' is the
      // required list of turns. If it's missing or renamed, emitting zero
      // chunks would be silent data loss. Warn so drift is observable.
      if (composer.fullConversationHeadersOnly === undefined) {
        const suspiciousRename = Object.entries(composer as unknown as Record<string, unknown>).find(
          ([, v]) =>
            Array.isArray(v) &&
            v.length > 0 &&
            isRecord(v[0]) &&
            "bubbleId" in (v[0] as Record<string, unknown>),
        );
        warnDrift(
          `${wsPathForWarn}#composerData:${ref.composerId}`,
          suspiciousRename
            ? `'fullConversationHeadersOnly' missing; suspected rename to '${suspiciousRename[0]}'`
            : "'fullConversationHeadersOnly' missing — composer has no turn list",
        );
        continue;
      }

      if (!Array.isArray(composer.fullConversationHeadersOnly)) {
        warnDrift(
          `${wsPathForWarn}#composerData:${ref.composerId}`,
          `expected 'fullConversationHeadersOnly' to be an array, got ` +
            describeType(composer.fullConversationHeadersOnly),
        );
        continue;
      }

      if (composer.modelConfig !== undefined && composer.modelConfig !== null &&
          !isRecord(composer.modelConfig)) {
        warnDrift(
          `${wsPathForWarn}#composerData:${ref.composerId}`,
          `expected 'modelConfig' to be object or absent, got ${describeType(composer.modelConfig)}`,
        );
      } else if (composer.modelConfig === null) {
        warnDrift(
          `${wsPathForWarn}#composerData:${ref.composerId}`,
          "'modelConfig' is null — falling back to composerId as model label",
        );
      }

      const headers = composer.fullConversationHeadersOnly ?? [];
      if (headers.length === 0) continue;

      const model =
        composer.modelConfig?.modelName ?? ref.composerId;
      const composerMode = normalizeComposerMode(
        composer.unifiedMode ?? ref.unifiedMode,
      );
      const sessionId = ref.composerId;
      const composerHeader = composerHeaders?.get(ref.composerId);
      const subagent = composerHeader?.isSubagent === true;
      // A subagent's first "user" turn is the prompt its parent agent wrote
      // for it. It is kept, because it says what the subagent was asked, but
      // not as the person's words.
      let promptSeen = false;

      let messageIndex = 0;
      for (const header of headers) {
        const bubbleRow = getBubble.get(
          `bubbleId:${ref.composerId}:${header.bubbleId}`,
        ) as { value: string } | undefined;

        // Both skips advance `messageIndex`, like the two below them.
        // `scan.ts` hashes the index into the row id, so an index that counts
        // only the bubbles that happened to be present shifts every later turn
        // down by one the moment Cursor prunes an earlier bubble — and
        // `ACCEPTED_DEGRADATIONS.prunedBubble` records that pruning as normal.
        // Those turns then re-insert under new ids beside the old rows, which
        // `pruneRereadSessions` does not clear on an incremental pass.
        if (!bubbleRow) {
          messageIndex++;
          continue;
        }

        let bubble: CursorBubbleData;
        try {
          bubble = JSON.parse(bubbleRow.value) as CursorBubbleData;
        } catch {
          messageIndex++;
          continue;
        }

        const timestamp = toDate(bubble.createdAt);
        if (since.getTime() > 0 && timestamp <= since) {
          messageIndex++;
          continue;
        }

        let content = toNonEmptyString(bubble.text) ?? "";
        let role = normalizeRole(bubble.type);
        if (!content) {
          // A tool call is a bubble with no text, so reading text alone
          // dropped every edit, command and search an agent made: 2,200
          // bubbles became 278 chunks on a real store. One line says what it
          // did; thinking bubbles have neither text nor a tool and stay out.
          const toolLine = describeToolBubble(bubble);
          if (!toolLine) {
            messageIndex++;
            continue;
          }
          content = toolLine;
          role = "tool";
        } else if (subagent && role === "user" && !promptSeen) {
          promptSeen = true;
          role = "tool";
        }

        yield {
          tool: "cursor",
          sessionId,
          timestamp,
          role,
          content,
          metadata: {
            messageIndex,
            tokenEstimate: estimateTokens(content),
            referencedFiles: [],
            model: bubble.modelInfo?.modelName ?? model,
            composerMode,
            ...(subagent ? { subagent: true, subagentType: composerHeader?.subagentType } : {}),
          },
        };
        messageIndex++;
      }
    }
  }

  private async resolveWorkspaceDatabasePaths(): Promise<string[]> {
    try {
      const target = await stat(this.cursorStorePath);
      if (target.isFile()) {
        // Scoped like any database found by walking. This branch used to
        // return the path unchecked, and it is the branch a `storePath`
        // override reaches — a committable `.xtctx/config.yaml` naming any
        // `state.vscdb` on the machine, whose every composer was then read as
        // this project's.
        if (!this.projectRoot) {
          return [this.cursorStorePath];
        }
        return (await workspaceMatchesProject(this.cursorStorePath, this.projectRoot))
          ? [this.cursorStorePath]
          : [];
      }

      if (!target.isDirectory()) {
        return [];
      }
    } catch {
      return [];
    }

    const paths = await glob("**/state.vscdb", {
      cwd: this.cursorStorePath,
      absolute: true,
      nodir: true,
    });
    if (!this.projectRoot) {
      return paths;
    }

    const filtered: string[] = [];
    for (const path of paths) {
      if (await workspaceMatchesProject(path, this.projectRoot)) {
        filtered.push(path);
      }
    }
    return filtered;
  }
}

function canOpen(DatabaseCtor: typeof Database, path: string): boolean {
  try {
    new DatabaseCtor(path, { readonly: true, fileMustExist: true }).close();
    return true;
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}


/**
 * Derive the Cursor global storage path from a workspace database path.
 *
 * Workspace path structure:
 *   .../Cursor/User/workspaceStorage/<hash>/state.vscdb
 * Global storage:
 *   .../Cursor/User/globalStorage/state.vscdb
 */
/**
 * Fields Cursor records file locations under, inside a composer.
 *
 * Named explicitly rather than matching anything that looks like a path: the
 * question being answered is "did this conversation touch this project", and
 * only a recorded file location answers it. Prose that happens to contain a
 * path-shaped string does not — a conversation quoting someone else's error
 * message must not be filed under their project.
 */
const COMPOSER_PATH_FIELDS = new Set(["fsPath", "external", "toolDisplayPath", "repoPath", "path"]);

/**
 * Only a *string* under one of those keys counts, which reads like a gap: an
 * array of paths under `path` would be walked into and every element ignored,
 * because the recursion below only descends into records.
 *
 * Measured before deciding it was one. Every composer in a real Cursor
 * globalStorage (603 of them, 2026-09-04) holds these fields as strings and
 * nothing else — 8,881 `toolDisplayPath`, 8,860 `path`, 8,853 `external`,
 * 6,479 `fsPath`, 42 `repoPath`, zero arrays among them. So the array branch
 * would be code written for a shape Cursor does not emit, and it fails closed
 * regardless: an unmatched composer is left unattributed, never misfiled under
 * someone else's project.
 *
 * If Cursor starts emitting one, the symptom is conversations quietly missing
 * from a project rather than anything visibly broken — so this note is here to
 * be found by whoever goes looking.
 */

/** How deep to walk a composer looking for recorded file locations. */
const COMPOSER_PATH_DEPTH = 6;

/**
 * Whether a composer records a file inside the given project.
 *
 * Fails closed: a conversation with no recorded location is not attributed to
 * anything, matching the project boundary the other readers hold to.
 */
function composerMentionsProject(composer: unknown, projectRoot: string): boolean {
  return walkForProjectPath(composer, projectRoot, 0);
}

function walkForProjectPath(value: unknown, projectRoot: string, depth: number): boolean {
  if (depth > COMPOSER_PATH_DEPTH) return false;

  if (Array.isArray(value)) {
    return value.some((item) => walkForProjectPath(item, projectRoot, depth + 1));
  }

  if (!isRecord(value)) return false;

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && COMPOSER_PATH_FIELDS.has(key)) {
      if (pathMatchesProject(decodeFileUri(item), projectRoot)) return true;
      continue;
    }
    if (walkForProjectPath(item, projectRoot, depth + 1)) return true;
  }

  return false;
}

function decodeFileUri(value: string): string {
  if (!value.startsWith("file:///")) return value;
  try {
    return decodeURIComponent(value.slice("file:///".length));
  } catch {
    return value.slice("file:///".length);
  }
}

/**
 * globalStorage for a configured store path.
 *
 * The store is normally `<user>/workspaceStorage`, but it can also be pointed
 * at a single workspace directory inside it, which is what the tests do and
 * what a `storePath` override may do. Both resolve to the same sibling.
 */
function globalStoragePathForStore(storePath: string): string | null {
  const normalized = storePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/workspaceStorage");
  if (index === -1) return null;
  return join(normalized.slice(0, index), "globalStorage", "state.vscdb");
}

/** The `workspaceStorage` directory a store path is, or sits inside. */
function workspaceStorageDirForStore(storePath: string): string | null {
  const normalized = storePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const marker = "/workspaceStorage";
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return null;
  return normalized.slice(0, index + marker.length);
}

function deriveGlobalStoragePath(workspaceDbPath: string): string | null {
  const normalized = workspaceDbPath.replace(/\\/g, "/");
  const wsIdx = normalized.indexOf("/workspaceStorage/");
  if (wsIdx === -1) return null;

  const userDir = normalized.slice(0, wsIdx);
  return join(userDir, "globalStorage", "state.vscdb");
}

function normalizeRole(value?: number | string): CursorChunk["role"] {
  // Numeric type from bubble data: 1 = user, 2 = assistant.
  if (typeof value === "number") {
    if (value === BUBBLE_TYPE_USER) return "user";
    if (value === BUBBLE_TYPE_ASSISTANT) return "assistant";
    return "system";
  }

  // String role from legacy format.
  const map: Record<string, CursorChunk["role"]> = {
    user: "user",
    human: "user",
    assistant: "assistant",
    ai: "assistant",
    system: "system",
    tool: "tool",
  };
  return map[(value ?? "").toLowerCase()] ?? "system";
}

function normalizeComposerMode(value?: string): CursorChunk["metadata"]["composerMode"] {
  return value === "agent" ? "agent" : "normal";
}

const TOOL_LINE_MAX = 200;

/** Argument names a tool call records its target under, most specific first. */
const TOOL_TARGET_KEYS = [
  "relativeWorkspacePath",
  "targetFile",
  "filePath",
  "path",
  "targetDirectory",
  "effectiveUri",
  "title",
  "pattern",
  "globPattern",
  "query",
  "command",
  "description",
];

/**
 * One short line for a tool-call bubble: `used edit_file_v2: src/a.ts`.
 *
 * The arguments are never indexed whole — an edit carries the file's new
 * content — only the first line of the target, so the index learns what was
 * touched without holding what was written.
 */
function describeToolBubble(bubble: CursorBubbleData): string | undefined {
  const tool = bubble.toolFormerData;
  if (!isRecord(tool)) {
    return undefined;
  }

  const name = toNonEmptyString(tool.name) ?? "tool";
  const args = parseToolArguments(tool.params) ?? parseToolArguments(tool.rawArgs) ?? {};
  let target = "";
  for (const key of TOOL_TARGET_KEYS) {
    const value = toNonEmptyString(args[key]);
    if (value) {
      target = value.split(/\r?\n/, 1)[0] ?? "";
      break;
    }
  }

  const line = target ? `used ${name}: ${target}` : `used ${name}`;
  return line.length > TOOL_LINE_MAX ? `${line.slice(0, TOOL_LINE_MAX)}…` : line;
}

/** Cursor stores a tool's arguments as a JSON string; tolerate an object too. */
function parseToolArguments(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

