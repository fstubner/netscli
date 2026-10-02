import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { inspectManagedFile, pathExists } from "../config/setup.js";
import { inspectMcpWiring, type McpWiringState } from "../config/mcp-config.js";
import { readClaudeHookPin } from "../config/claude-settings.js";
import { inspectSkillStatus } from "../config/skills.js";
import { createProjectServices, type ProjectServices } from "../runtime/services.js";
import {
  BACKGROUND_EMBED_BUDGET_MS,
  estimateVectorBacklog,
  formatDuration,
} from "../utils/duration.js";
import { readDriftLog, type DriftLogFile } from "../scrapers/drift-log.js";
import { SUPPORTED_TOOLS } from "../tools/sources.js";
import { readXtctxPackage } from "../utils/package-info.js";
import { describeCloudSync } from "../sync/report.js";
import { ENABLE_SEMANTIC_HINT } from "../handoff/embedding-runtime.js";

interface StatusOptions {
  projectPath?: string;
  verbose?: boolean;
}

export async function runStatus(options: StatusOptions = {}): Promise<void> {
  const projectRoot = resolve(options.projectPath ?? process.cwd());

  // A path that does not exist produced a full, plausible status report about
  // it — ending in "run xtctx setup" — so a typo'd `--project` answered
  // confidently about nothing. Diagnostics that cannot tell a mistyped path
  // from an unconfigured one are worse than no diagnostics.
  if (!existsSync(projectRoot)) {
    process.stderr.write(`No such directory: ${projectRoot}
`);
    process.exitCode = 1;
    return;
  }

  // Diagnostics do not configure. Running `status` on a project left a
  // database behind in one it had only been asked to look at.
  const services = await createProjectServices(projectRoot, { createIfMissing: false });
  try {
    process.stdout.write((await renderStatusBlock(services, { verbose: options.verbose })) + "\n");
  } finally {
    await services.sessions.close().catch(() => {});
  }
}

interface StatusRenderOptions {
  /**
   * Home directory to resolve global MCP configs against. Production uses the
   * real one; tests that configure a sandbox home must inspect that same home,
   * or every globally-scoped tool looks unwired.
   */
  homeDir?: string;
  /**
   * Every format surprise with its sightings and location, skill hashes, and
   * absolute paths. Off by default: those are for diagnosing a reader, and
   * printed every time they were most of the report.
   */
  verbose?: boolean;
}

/** @internal Exported for tests only. */
export async function renderStatusBlock(
  services: ProjectServices,
  options: StatusRenderOptions = {},
): Promise<string> {
  const { version } = readXtctxPackage(import.meta.url);
  const status = await services.sessions.getStatus();
  // A tool switched off -- by `disconnect`, or by hand -- is not reported as
  // missing anything. It was, and the fix status offered was `setup`, which
  // wired the tool straight back in.
  const disabledTools = new Set<string>(
    SUPPORTED_TOOLS.map((tool) => tool.id).filter((id) => services.config.tools?.[id]?.enabled === false),
  );
  const skills = await inspectSkillStatus(services.projectRoot, services.configPath, disabledTools);
  const configPresent = await pathExists(services.configPath);
  const enabledTools = SUPPORTED_TOOLS.map((tool) => tool.id).filter((id) => !disabledTools.has(id));
  // Only tools actually installed here can be "broken": a global config for
  // a tool the user does not have is absent for a good reason, and nagging
  // about it every run is the crying-wolf failure this command exists to avoid.
  const detectedTools = new Set(status.tools.filter((tool) => tool.detected).map((tool) => tool.tool));
  const mcpWiring = configPresent ? await inspectMcpWiring(services.projectRoot, "xtctx", enabledTools, options.homeDir ? { homeDir: options.homeDir } : {}) : [];
  const managed = await Promise.all(
    managedTargets(services.projectRoot)
      .filter((target) => !target.readers.every((reader) => disabledTools.has(reader)))
      .map(async (target) => ({
      ...target,
      ...(await inspectManagedFile(target.path)),
    })),
  );

  const verbose = options.verbose === true;
  // Paths inside the project are shown relative to it: the Project line
  // already names the root, and the same absolute prefix on every other line
  // was most of the width. Anything outside it -- a global MCP config, a store
  // -- stays absolute, because that is the part worth noticing.
  const show = (path: string): string => {
    if (verbose) return path;
    const rel = relative(services.projectRoot, path);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
  };

  const lines: string[] = [];
  lines.push(`xtctx ${version} - handoff status`);
  lines.push("");
  lines.push(`Project  ${services.projectRoot}`);
  lines.push(`Config   ${configPresent ? show(services.configPath) : "missing (run xtctx setup)"}`);
  if (services.config.error) {
    // Loud, and immediately under the path it refers to: nothing is being
    // scanned at all while this holds, which is otherwise invisible — the
    // tools below would simply report zero sessions each.
    lines.push(`         UNREADABLE: ${services.config.error}`);
    lines.push(`         No transcripts are being read until this is fixed.`);
  }
  lines.push(`Index    ${show(services.dbPath)}`);
  lines.push(`MCP      ${describeMcpCommand(mcpWiring)}`);
  if (configPresent) {
    const pin = describePin(
      [...mcpWiring.map((entry) => pinFromCommand(entry.command)), await readClaudeHookPin(services.projectRoot)],
      version,
    );
    if (pin) lines.push(`Pinned   ${pin}`);
  }
  const scanTook = formatDuration(status.last_scan_ms);
  lines.push(
    `Scan     ${status.last_scan_at ?? "never"}${scanTook ? ` (took ${scanTook})` : ""}`,
  );
  // Which way search is answered, always. Off is the default of a fresh install
  // and is not a fault, so it is stated once, with the way to turn it on, and
  // none of the backlog lines below appear for it.
  const semanticOff = status.semantic_search === "off";
  if (semanticOff) {
    lines.push(
      status.semantic_off_reason === "disabled_by_env"
        ? "Search   keyword only (XTCTX_DISABLE_EMBEDDINGS=1 is set)"
        : `Search   keyword only. Semantic search is optional: ${ENABLE_SEMANTIC_HINT}`,
    );
    if (status.vectorized_units > 0) {
      // An index that had vectors before the add-on was split out. They are not
      // deleted, and they work again the moment the model is back.
      lines.push(
        `         ${status.vectorized_units} windows already have vectors; they are kept and used again once semantic search is on`,
      );
    }
  } else if (status.embedding_error) {
    lines.push(`Search   semantic unavailable (keyword only): ${status.embedding_error}`);
  } else {
    lines.push(
      status.semantic_search === "remote"
        ? "Search   keyword + semantic (external endpoint)"
        : "Search   keyword + semantic (local model)",
    );
  }
  lines.push(
    `Data     ${status.sessions} sessions, ${status.messages} messages, ` +
      `${status.retrieval_units} retrieval windows${semanticOff ? "" : `, ${status.vectorized_units} vectorized`}`,
  );
  // The index is the only copy of these, and nothing else in this report
  // says so: deleting `.xtctx/state`, or losing the disk, loses them.
  if (status.index_only_sessions > 0) {
    const count = status.index_only_sessions;
    lines.push(
      `Backup   ${count} session${count === 1 ? " exists" : "s exist"} only in this index; ` +
        `back ${count === 1 ? "it" : "them"} up with \`xtctx export\``,
    );
  }
  // A backlog is only meaningful as a duration: "1762 windows left" says
  // nothing until it says "about 30 seconds".
  const backlog = estimateVectorBacklog(
    status.retrieval_units,
    status.vectorized_units,
    status.vector_ms_per_unit,
    {
      backlog: status.vector_segment_backlog,
      msPerSegment: status.vector_ms_per_segment,
    },
  );
  if (backlog.remaining > 0) {
    const rate = status.vector_ms_per_unit ? `${status.vector_ms_per_unit}ms/window` : "rate unknown";
    lines.push(
      `Embed    ${backlog.remaining} windows outstanding, ${rate}` +
        `${backlog.eta ? `, about ${backlog.eta} of embedding left` : ""}`,
    );
    // Say whether anything is actually working on it.
    //
    // The MCP server drains the backlog in the background only while the
    // estimate fits its budget, so on a slow machine with a large history
    // nothing is. Until this line existed that state was invisible and
    // indistinguishable from the one above it: semantic search quietly
    // answering from keyword, forever, with a status report that looked like
    // progress was being made. Naming the command is the point — the backlog
    // does not drain by waiting.
    if (backlog.etaMs !== null && backlog.etaMs > BACKGROUND_EMBED_BUDGET_MS) {
      lines.push(
        "         too large to finish in the background — run `xtctx scan --embed`",
      );
    }
  }
  // Only when it is not the default. A machine that has never been calibrated
  // is on the CPU, which is what every machine did before calibration existed,
  // and does not need a line saying so on every status call.
  if (status.vector_device && status.vector_device !== "cpu") {
    // Measured automatically the first time this machine embeds; `xtctx
    // calibrate` only re-measures. Crediting the command read as though the
    // user had run something they never had.
    lines.push(`Device   ${status.vector_device} (measured on this machine)`);
  }
  // An endpoint is the one thing that sends transcript text off this machine,
  // so it is stated in full and unconditionally whenever one is configured.
  // "Am I uploading my transcripts, and where to" must never require opening a
  // config file to answer. The identity already carries the endpoint because
  // `retrieval_unit_vectors` is keyed on it; the URL is what matters here, and
  // the API key is never part of it.
  if (status.vector_model.startsWith("openai:")) {
    const endpoint = status.vector_model.slice("openai:".length);
    lines.push(`Embedding  external endpoint — window text is sent to ${endpoint}`);
  }
  // Cloud upload is the other thing that sends transcripts off this machine,
  // so whether it is on here, and whether it is working, is always stated.
  const cloud = await describeCloudSync(services.projectRoot).catch((err: unknown) => [
    `unknown (${err instanceof Error ? err.message : String(err)})`,
  ]);
  lines.push(`Cloud    ${cloud[0]}`);
  for (const line of cloud.slice(1)) lines.push(`         ${line}`);
  lines.push("");
  lines.push("Tools:");

  for (const tool of status.tools) {
    const definition = SUPPORTED_TOOLS.find((item) => item.id === tool.tool);
    const hook = definition?.hookMode ?? "mcp-only";
    const marker = tool.detected ? "+" : "-";
    const error = tool.last_error ? `; last scrape error: ${tool.last_error}` : "";
    lines.push(
      `  ${marker} ${tool.tool.padEnd(13)} ${tool.detected ? "detected" : "not detected"}; ` +
        `${tool.indexed_sessions} sessions; hook: ${hook}${error}`,
    );
    for (const note of storePathNotes(definition, tool.store_paths)) {
      lines.push(`      ${note}`);
    }
  }

  const drift = (
    await Promise.all(
      status.tools.map(async (tool) => ({
        tool: tool.tool,
        log: await readDriftLog(services.stateDir, tool.tool),
      })),
    )
  ).filter((entry): entry is { tool: string; log: DriftLogFile } => (entry.log?.surprises.length ?? 0) > 0);

  if (drift.length > 0) {
    lines.push("");
    // Named for what it means rather than what the code calls it: these are
    // the places another tool's transcripts did not look the way this reader
    // expected, which is the first sign a tool has changed its format.
    //
    // One line by default. The full list -- record types, sighting counts,
    // file locations -- is for diagnosing a reader, and printed on every run
    // it was a third of the report, led by tens of thousands of "sightings"
    // of records the reader skips on purpose.
    if (!verbose) {
      const summary = drift.map(({ tool, log }) => `${tool} (${log.surprises.length})`).join(", ");
      lines.push(`Format surprises: ${summary} -- details: xtctx status --verbose`);
    } else {
      lines.push("Format surprises:");
      for (const { tool, log } of drift) {
        const kinds = plural(log.surprises.length, "kind");
        // `droppedSurprises` counts what the last write discarded, so it is only
        // ever about that write — not a running total of everything ever lost.
        const dropped =
          log.droppedSurprises > 0 ? `, ${log.droppedSurprises} dropped at the ceiling` : "";
        lines.push(`  ${tool.padEnd(13)} ${kinds}${dropped}`);
        for (const entry of log.surprises) {
          lines.push(`      ${entry.surprise}`);
          // The entry's own last sighting, not the file's write time: with the
          // whole-file timestamp a surprise that stopped months ago read exactly
          // like one still happening. And "sightings" rather than "records",
          // because the count accumulates across scans — a re-scan of the same
          // file raises it without a single new transcript record.
          lines.push(`        ${plural(entry.records, "sighting")}, last seen ${entry.lastSeen}`);
          lines.push(`        first at ${entry.firstLocation}`);
        }
      }
    }
  }

  // Everything below reports on wiring that setup creates, so in a project
  // that has not been set up every line of it reads `missing` — about thirty
  // of them, each carrying an absolute path, between the reader and the one
  // sentence that matters. A first-time user running `status` to see what
  // this thing does met a wall of faults describing the absence of a thing
  // they had not asked for yet.
  if (!configPresent) {
    lines.push("");
    lines.push("Next     This project is not set up yet. Run: xtctx setup");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Skills:");
  lines.push(`  source        ${show(skills.sourceDir)}`);
  for (const skill of skills.selected) {
    const marker = skill.exists ? (skill.staleBuiltIn ? "stale" : "ok") : "missing";
    const hash = verbose && skill.hash ? ` ${skill.hash.slice(0, 18)}` : "";
    lines.push(`  ${marker.padEnd(13)} ${skill.id}${hash}`);
    if (skill.staleBuiltIn) {
      lines.push(
        "           this project's copy predates the built-in skill shipped with " +
          "this version; run `xtctx setup --yes` to refresh it",
      );
    }
  }
  for (const target of skills.targets) {
    const skillPart = target.skillId ? ` ${target.skillId}` : "";
    const pathPart = target.path ? ` ${show(target.path)}` : "";
    lines.push(
      `  ${target.state.padEnd(13)} ${target.tool.padEnd(12)} ${target.mode.padEnd(20)}${skillPart}${pathPart}`,
    );
  }

  if (mcpWiring.length > 0) {
    lines.push("");
    lines.push("MCP wiring:");
    // The command per tool only when they differ: then "wired" alone does not
    // say what would run. When they agree, the MCP line above already says it,
    // and repeating it under every tool doubled the section.
    const commandsDiffer = describeMcpCommand(mcpWiring).startsWith("varies");
    for (const entry of mcpWiring) {
      const scope = entry.scope === "global" ? " (global config)" : "";
      const detail = entry.detail ? ` — ${entry.detail}` : "";
      const command =
        entry.command && (commandsDiffer || verbose) ? `\n${" ".repeat(30)}${entry.command}` : "";
      lines.push(
        `  ${(entry.wired ? "wired" : "not wired").padEnd(13)} ${entry.tool.padEnd(12)} ${show(entry.path)}${scope}${detail}${command}`,
      );
    }
  }

  lines.push("");
  lines.push("Managed files:");
  for (const file of managed) {
    const state = !file.exists
      ? "missing"
      : file.blockCount === 1 && file.staleReferences.length === 0
        ? "ok"
        : "needs repair";
    const details = [];
    if (file.blockCount !== 1) {
      details.push(`${file.blockCount} xtctx blocks`);
    }
    if (file.staleReferences.length > 0) {
      details.push(`stale: ${file.staleReferences.join(", ")}`);
    }
    lines.push(
      `  ${state.padEnd(13)} ${file.label.padEnd(15)} ${show(file.path)}${details.length ? ` (${details.join("; ")})` : ""}`,
    );
  }

  // Status always ends with one concrete next step, as ux-walkthrough.md
  // promises. Repairing wiring outranks indexing advice: a drifted managed
  // file or missing skill target is why an agent would see nothing at all.
  // A project that was never set up has not "drifted" — there is nothing to
  // repair, and telling a first-time user to run a repair command reads as
  // though something is already broken. Never configured and configured-then-
  // damaged are different states and get different advice.
  // What is out of date, by kind, so the last line can say which. It used to
  // say "Wiring has drifted" for all of them -- including a skill copy that
  // differed, which is not wiring -- and send everyone to `setup --repair`,
  // which deleted the index. Plain `setup` rewrites every one of these.
  const outOfDate: string[] = [];
  // A tool that is enabled but has no xtctx entry in its own MCP config is
  // the most complete way to be broken: the agent simply never sees xtctx.
  // A config that was never written is not drift: `setup` only writes some
  // global configs when asked (`--global-mcp`), so demanding one would tell a
  // correctly-set-up project to repair itself forever. A config that exists
  // but has lost its entry is the real thing.
  const unwired = mcpWiring.filter(
    (entry) => !entry.wired && entry.configExists && detectedTools.has(entry.tool),
  );
  if (unwired.length > 0) {
    outOfDate.push(`MCP config for ${unwired.map((entry) => entry.tool).join(", ")}`);
  }
  const damagedBlocks = managed.filter(
    (file) => file.exists && (file.blockCount !== 1 || file.staleReferences.length > 0),
  );
  if (damagedBlocks.length > 0) {
    outOfDate.push(`instruction blocks in ${damagedBlocks.map((file) => show(file.path)).join(", ")}`);
  }
  if (skills.selected.some((skill) => !skill.exists)) {
    outOfDate.push("the project skill source");
  }
  // Only `missing` and `drift` are faults. `managed-block` and `unsupported`
  // are the normal, healthy states for tools that carry skills inside their
  // instruction file or not at all.
  const skewedSkills = [
    ...new Set(
      skills.targets
        .filter((target) => target.state === "missing" || target.state === "drift")
        .map((target) => target.tool),
    ),
  ];
  if (skewedSkills.length > 0) {
    outOfDate.push(`skill copies for ${skewedSkills.join(", ")}`);
  }
  const needsRepair = configPresent && outOfDate.length > 0;

  lines.push("");
  if (services.config.error) {
    // Checked before everything below it, because nothing below it can be
    // true while this holds. Nothing is scanned at all with an unreadable
    // config, so "ask an agent to call xtctx_recent_sessions" is advice that
    // cannot work, and with an index left over from before the file broke the
    // old branch cheerfully reported "Handoff is wired" six lines under
    // "UNREADABLE ... No transcripts are being read until this is fixed."
    // The last line is the one people act on.
    lines.push(`Next     Fix ${services.configPath} — nothing is being read until it parses.`);
  } else if (needsRepair) {
    lines.push(`Next     Out of date: ${outOfDate.join("; ")}.`);
    lines.push("         Run: xtctx setup --yes  (rewrites them; transcripts and the index are untouched)");
  } else if (status.sessions === 0) {
    // Worded as expected rather than as a fault. Running `status` straight
    // after `setup` is the obvious way to check setup worked, and it lands
    // here: nothing is indexed until an agent calls a tool, so `Scan never`
    // and `0 sessions` are what a correct install looks like at this point.
    lines.push(
      "Next     Nothing is indexed yet, which is expected until an agent calls a tool.",
    );
    lines.push(
      "         Restart any agent that was open when setup ran, then ask it for recent context.",
    );
  } else {
    lines.push("Next     Handoff is wired. Ask a configured agent to call xtctx_recent_sessions.");
  }

  return lines.join("\n");
}

/**
 * The one-line answer to "what runs xtctx here", read from the configs.
 *
 * This line was the string literal `npx -y xtctx`, printed regardless of what
 * any config said. Status is the one place a person looks to find out what
 * their handoff is wired to, so a line that always says the same thing is
 * worse than no line: it reads as an answer. A project deliberately pointed at
 * a local build — because the published package was too old to work — was told
 * it was running the published package.
 *
 * Seven configs can disagree, and legitimately do, so there is not always one
 * answer. Saying so and pointing at the per-tool list beats picking a winner.
 */
export function describeMcpCommand(wiring: McpWiringState[]): string {
  const commands = [
    ...new Set(
      wiring.filter((entry) => entry.wired && entry.command).map((entry) => entry.command as string),
    ),
  ];

  if (commands.length === 1) {
    return commands[0];
  }
  if (commands.length === 0) {
    return "nothing wired (run xtctx setup)";
  }
  return "varies by tool - see MCP wiring below";
}

/** `1.2.3` out of `npx -y xtctx@1.2.3`, or null for an unpinned or non-npx command. */
function pinFromCommand(command: string | undefined): string | null {
  const match = command ? /(?:^|[\s/])xtctx@(\S+)/.exec(command) : null;
  return match ? match[1] : null;
}

/**
 * Which version the generated commands are pinned to, and whether that is the
 * version running now. Null when nothing is pinned (a self-hosted checkout, or
 * a project set up before pinning), where there is nothing to report.
 *
 * Setup pins the MCP entries and the Claude Code hook to the version that ran
 * it, so they stay on that version until setup runs again. Saying so, and what
 * to run, is the whole point: otherwise a pin is an old version nobody chose.
 */
function describePin(pins: Array<string | null>, running: string): string | null {
  const found = [...new Set(pins.filter((pin): pin is string => pin !== null))];
  if (found.length === 0) return null;
  if (found.length === 1 && found[0] === running) {
    return `xtctx@${running} (matches the running version)`;
  }
  return (
    `${found.map((pin) => `xtctx@${pin}`).join(", ")} but running ${running} - ` +
    "run `xtctx setup --yes` to update"
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function managedTargets(projectRoot: string): Array<{ label: string; path: string; readers: string[] }> {
  return [
    { label: "codex/opencode", path: join(projectRoot, "AGENTS.md"), readers: ["codex", "opencode"] },
    { label: "claude-code", path: join(projectRoot, "CLAUDE.md"), readers: ["claude-code"] },
    { label: "antigravity", path: join(projectRoot, "GEMINI.md"), readers: ["antigravity"] },
    { label: "cursor", path: join(projectRoot, ".cursor", "rules", "xtctx.mdc"), readers: ["cursor"] },
    {
      label: "copilot",
      path: join(projectRoot, ".github", "copilot-instructions.md"),
      readers: ["copilot", "copilot-cli"],
    },
  ];
}

/** Store paths that differ from the tool's built-in default location. */
/**
 * Notes about where a tool's transcripts are being read from.
 *
 * Two different situations look identical in the config file. A path that
 * differs from the default may be a deliberate override — `.xtctx/config.yaml`
 * is committable, so a cloned repo can legitimately point a scraper anywhere,
 * and those stay legal but visible. Or it may simply be stale: setup records
 * where the tool kept its data that day, and tools move. opencode turned out
 * to write to the XDG location on Windows rather than %APPDATA%, so every
 * project set up before that was fixed still points at a path that has never
 * existed, and reports "not detected" forever with a real store sitting
 * elsewhere.
 *
 * Nothing is rewritten here — a config file is the user's. But the stale case
 * is named, with the path that does exist and how to adopt it.
 * @internal Exported for tests only.
 */
export function storePathNotes(
  definition: (typeof SUPPORTED_TOOLS)[number] | undefined,
  storePaths: string[],
  homeDir: string = process.env.USERPROFILE ?? process.env.HOME ?? "",
): string[] {
  if (!definition) {
    return [];
  }

  let resolved: string;
  try {
    resolved = definition.defaultStorePath();
  } catch {
    return [];
  }

  const notes: string[] = [];
  for (const path of storePaths) {
    if (normalizePath(path) === normalizePath(resolved)) {
      continue;
    }

    // One note per path, whatever is wrong with it.
    //
    // An override is legal by design — a cloned repo can legitimately point a
    // scraper anywhere — but not every override is equal. One inside your home
    // is a tool keeping data somewhere unusual. One outside it arrived from
    // somewhere, and `.xtctx/config.yaml` is committable, so a clone can carry
    // one and nothing would otherwise say so.
    //
    // It is a qualifier on the note rather than a note of its own: where a
    // path points and whether it resolves are independent facts, and emitting
    // them separately doubled the count callers read as "problems with this
    // path". Saying both in one line keeps the actionable half — the store
    // that does exist, and how to adopt it — attached to the warning.
    const suffix =
      homeDir && !isInsideDir(path, homeDir)
        ? " — WARNING: this is outside your home directory; xtctx will read " +
          "transcripts from there. If you did not set it, check .xtctx/config.yaml " +
          "(it is committable, so a cloned repo can carry one)"
        : "";

    if (!existsSync(path) && existsSync(resolved)) {
      notes.push(
        `stale store path: ${path} does not exist, but ${definition.id} has a store at ` +
          `${resolved} — re-run 'xtctx setup --yes' to point at it${suffix}`,
      );
      continue;
    }
    notes.push(`custom store path (not the ${definition.id} default): ${path}${suffix}`);
  }

  return notes;
}

function isInsideDir(candidate: string, root: string): boolean {
  const c = normalizePath(candidate);
  const r = normalizePath(root);
  return c === r || c.startsWith(`${r}/`);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
