#!/usr/bin/env node
import { Command, Option } from "commander";
import { runExport, runImport } from "./backup.js";
import { runCalibrate } from "./calibrate.js";
import { runDisconnect } from "./disconnect.js";
import { runHook } from "./hook.js";
import { runScan } from "./scan.js";
import { runSetup } from "./setup.js";
import { runStatus } from "./status.js";
import { runLogin, runLogout } from "./login.js";
import { runSync, runSyncSetting } from "./sync.js";
import { startAutoSync, type AutoSync } from "../sync/auto-sync.js";
import { createProjectServices } from "../runtime/services.js";
import { startMcpServer } from "../mcp/server.js";
import { readXtctxPackage } from "../utils/package-info.js";
import { runBackgroundWork } from "../runtime/background.js";
import { localEmbeddingsActive } from "../handoff/embedding-config.js";
import { runEmbeddingsDisable, runEmbeddingsEnable } from "./embeddings.js";

const { version: CLI_VERSION } = readXtctxPackage(import.meta.url);

export async function main(argv = process.argv): Promise<void> {
  if (shouldStartMcp(argv)) {
    const services = await createProjectServices(process.cwd());
    // Nobody opted this directory in. Say so instead of scanning every
    // transcript store on the machine to return an empty result that reads
    // like a configured project with no history.
    const unconfiguredProjectRoot = services.config.present ? undefined : services.projectRoot;
    let closed = false;
    let autoSync: AutoSync | undefined;
    const shutdown = (exit: boolean) => {
      if (closed) return;
      closed = true;

      // `close()` waits for any in-flight scan to settle, which is right while
      // the server is serving — it stops a scan writing into a closed handle.
      // It is wrong once the client has gone: a scan of every transcript store
      // on the machine takes over a minute, and the server sat there for 84
      // seconds after stdin closed. A host that spawns a server per session
      // accumulates those.
      //
      // So give the clean close a moment, then leave. Nothing is lost by not
      // waiting: every chunk is committed as it is written, and an
      // unfinished scan simply resumes on the next run.
      //
      // `close()` now stops a scan at its next checkpoint, a few tens of
      // milliseconds away, so the clean close normally wins and releases the
      // scan lease and empties the write-ahead log on the way out. The timer
      // is the backstop for work that cannot be interrupted. It used to be
      // the usual way out, which also meant the index was never closed.
      //
      // The cloud flush has its own bound, added on top: it is a network call,
      // not the scan this grace window exists to cut short.
      const graceMs = 2_000 + (autoSync ? 1_500 : 0);
      const timer = setTimeout(() => {
        if (exit) process.exit(0);
      }, graceMs);
      timer.unref?.();

      // Upload what the last interval left while the index closes. Side by
      // side, not one after the other: the upload reads the index through its
      // own read-only connection, so closing this one does not disturb it, and
      // a slow upload must not hold back the close that stops the scan and
      // releases the scan lease. Each statement the upload runs is its own
      // short read, so it does not keep the close from emptying the log.
      void Promise.allSettled([autoSync?.stop() ?? Promise.resolve(), services.sessions.close()])
        .finally(() => {
          clearTimeout(timer);
          if (exit) process.exit(0);
        });
    };
    process.once("SIGINT", () => shutdown(true));
    process.once("SIGTERM", () => shutdown(true));
    // Exit once the transport closes, rather than waiting for the event loop
    // to drain. The client is gone, so there is nothing left to serve, and the
    // server otherwise sat there for 84 seconds while a scan finished. An MCP
    // host that spawns a server per session accumulates those.
    //
    // Nothing is lost by leaving before a scan finishes: every chunk is
    // committed as it is written, and a scraper's cursor only advances once
    // its loop completes, so interrupted work is re-read rather than skipped.
    //
    // A tool call still in flight when stdin closes may go unanswered — the
    // grace window above is enough for ordinary calls, not for one waiting on
    // a scan. The client has closed its side by then, so nothing is listening.
    // A config that exists but will not parse is not an empty project, and
    // used to reach an agent as one: zero scrapers, "No matching sessions
    // found.", and the agent telling the user there is no cross-tool history
    // here. The CLI has said `UNREADABLE` for a while; agents never read it.
    const configError = services.config.error
      ? {
          projectRoot: services.projectRoot,
          configPath: services.configPath,
          message: services.config.error,
        }
      : undefined;
    await startMcpServer(
      { sessions: services.sessions, unconfiguredProjectRoot, configError },
      () => shutdown(true),
    );

    // Warm the index now rather than on the first tool call. The host starts
    // this process at session start and keeps it for the session, so a scan
    // begun here is finished by the time the next session's hook reads the
    // index — which is what turns "Last scan: never" into a pointer at the
    // other tool's work. Not awaited, and never for an unconfigured project:
    // the scan writes an index.
    //
    // Every start, with no freshness gate. There was one — skip if a scan
    // finished in the last five minutes — and it failed the case this exists
    // for: Codex starts this server too, so its own session start stamped the
    // index a few seconds in, before Codex had written anything, and the
    // Claude Code session that followed trusted the stamp and skipped. Two
    // sessions in a row saw the stale stamp and no Codex session. A finish
    // time says nothing about what another tool wrote afterwards. The
    // incremental scan this costs measured 9.7s in the background against a
    // 19GB Codex store, and the cursor design keeps it from re-reading.
    if (!unconfiguredProjectRoot && !services.config.error) {
      void runBackgroundWork({
        sessions: services.sessions,
        localEmbeddings: localEmbeddingsActive(services.config.embedding),
      });
      // Uploads only when logged in and this project is opted in; see auto-sync.ts.
      autoSync = startAutoSync({
        projectRoot: services.projectRoot,
        log: (line) => process.stderr.write(`${line}\n`),
      });
    }
    return;
  }

  const program = new Command();

  program
    .name("xtctx")
    .description(
      [
        "Local cross-tool handoff for AI coding agents.",
        "",
        "Your coding agents already write transcripts. xtctx indexes them and",
        "serves them over MCP, so the next agent you open can read what the",
        "last one did in this repo.",
        "",
        "Start with:  xtctx setup",
        "",
        "Run with no command and non-interactive stdio and xtctx starts its MCP",
        "server over stdio. Set XTCTX_NO_AUTO_MCP=1 to print this help instead,",
        "which is what you want when scripting xtctx from a pipe.",
      ].join("\n"),
    )
    .version(CLI_VERSION)
    .showHelpAfterError();

  program
    .command("setup")
    .argument("[projectPath]", "Project root to configure")
    .option("-p, --project <path>", "Project root to configure")
    .option("-y, --yes", "Apply setup without prompting", false)
    .option("--repair", "Also remove files left by older xtctx versions (.xtctx/.store, .xtctx/tool-config); the index is kept", false)
    .option("--global-mcp", "Also configure Copilot CLI global MCP (Antigravity MCP is always configured)", false)
    .description("Set this project up so agents can read each other's history here")
    .action(
      async (
        projectPath: string | undefined,
        options: { project?: string; yes: boolean; repair: boolean; globalMcp: boolean },
      ) => {
        const globalOptions = program.opts<{ project?: string }>();
        await runSetup({
          projectPath: options.project ?? globalOptions.project ?? projectPath,
          yes: options.yes,
          repair: options.repair,
          includeGlobalMcp: options.globalMcp,
        });
      },
    );

  program
    .command("status")
    .option("-p, --project <path>", "Project root (defaults to cwd)")
    .option("-v, --verbose", "Include every format surprise, skill hashes and full paths", false)
    .description("Check whether handoff is working here, and what to do if not")
    .action(async (options: { project?: string; verbose?: boolean }) => {
      const globalOptions = program.opts<{ project?: string }>();
      await runStatus({ projectPath: options.project ?? globalOptions.project, verbose: options.verbose });
    });

  program
    .command("login")
    .option("--sync-url <url>", "Sync server URL (default: https://sync.xtctx.com)")
    .option("--device <name>", "Name this device shows as in the cloud (default: a random label)")
    .description("Sign in to xtctx cloud with GitHub (uploads nothing by itself)")
    .action(async (options: { syncUrl?: string; device?: string }) => {
      await runLogin({ syncUrl: options.syncUrl, deviceName: options.device });
    });

  program
    .command("logout")
    .option("--delete-data", "Also delete everything uploaded to your cloud account", false)
    .description("Sign out of xtctx cloud and revoke this account's tokens")
    .action(async (options: { deleteData?: boolean }) => {
      await runLogout({ deleteData: options.deleteData });
    });

  program
    .command("sync")
    .argument("[action]", "enable, disable or status for this project; device [name]; token; omit to upload once")
    .argument("[value]", "the new name, for `sync device <name>`")
    .option("-p, --project <path>", "Project root (defaults to cwd)")
    .option("-w, --watch", "Keep uploading every few seconds until interrupted", false)
    .description("Cloud sync: choose whether this project uploads, or upload now")
    .action(async (action: string | undefined, value: string | undefined, options: { project?: string; watch?: boolean }) => {
      const globalOptions = program.opts<{ project?: string }>();
      const projectDir = options.project ?? globalOptions.project;
      if (action) {
        await runSyncSetting(action, { projectDir, value });
      } else {
        await runSync({ projectDir, watch: options.watch });
      }
    });

  program
    .command("scan")
    .option("-p, --project <path>", "Project root (defaults to cwd)")
    .option(
      "--embed",
      "Also embed every window, so semantic search covers the whole history (slow: hours on a large one)",
      false,
    )
    .option(
      "--no-calibrate",
      "With --embed, skip measuring which device embeds fastest on this machine",
    )
    .description("Index this project's transcripts now instead of waiting for an agent to ask")
    .action(async (options: { project?: string; embed?: boolean; calibrate?: boolean }) => {
      const globalOptions = program.opts<{ project?: string }>();
      await runScan({
        projectPath: options.project ?? globalOptions.project,
        embed: options.embed,
        calibrate: options.calibrate,
      });
    });

  program
    .command("export")
    .option("-p, --project <path>", "Project root (defaults to cwd)")
    .option(
      "-o, --out <file>",
      "File to write; '-' for stdout (default: xtctx-export-<time>.jsonl here). Never overwrites",
    )
    .description(
      "Back up this project's indexed sessions, including those whose transcripts are gone",
    )
    .action(async (options: { project?: string; out?: string }) => {
      const globalOptions = program.opts<{ project?: string }>();
      await runExport({ projectPath: options.project ?? globalOptions.project, out: options.out });
    });

  program
    .command("import")
    .argument("<file>", "A file written by xtctx export")
    .option("-p, --project <path>", "Project root (defaults to cwd)")
    .description("Merge an xtctx export into this project's index; safe to repeat")
    .action(async (file: string, options: { project?: string }) => {
      const globalOptions = program.opts<{ project?: string }>();
      await runImport({ projectPath: options.project ?? globalOptions.project, file });
    });

  program
    .command("calibrate")
    .option("--force", "Measure again even if this machine already has a verdict", false)
    .description("Find the fastest device on this machine for indexing, and use it")
    .action(async (options: { force: boolean }) => {
      await runCalibrate({ force: options.force });
    });

  const embeddings = program
    .command("embeddings")
    .description("Turn local semantic search on or off (it is an optional add-on)");

  embeddings
    .command("enable")
    .option("-y, --yes", "Install without asking, for scripts and agents", false)
    .description("Install the local embedding model so search can match by meaning as well as by keyword")
    .action(async (options: { yes: boolean }) => {
      await runEmbeddingsEnable({ yes: options.yes });
    });

  embeddings
    .command("disable")
    .description("Remove the local embedding model and its runtime; search goes back to keyword only")
    .action(async () => {
      await runEmbeddingsDisable();
    });

  program
    .command("disconnect")
    .argument("[tool]", "Tool to stop managing for this project")
    .option("--all", "Disconnect xtctx from all supported tools", false)
    .option(
      "--global-mcp",
      "Also remove xtctx from the machine-global Antigravity and Copilot CLI MCP configs",
      false,
    )
    .option("-p, --project <path>", "Project root")
    .option("-y, --yes", "Apply disconnect without prompting", false)
    .description("Stop xtctx managing a tool here, leaving your transcripts untouched")
    .action(
      async (
        tool: string | undefined,
        options: { all: boolean; globalMcp: boolean; project?: string; yes: boolean },
      ) => {
        const globalOptions = program.opts<{ project?: string }>();
        await runDisconnect({
          tool,
          all: options.all,
          globalMcp: options.globalMcp,
          projectPath: options.project ?? globalOptions.project,
          yes: options.yes,
        });
      },
    );

  program
    // Hidden, not removed: these are how a tool's hook re-enters this CLI,
    // never something a person types. Listed among `--project` and
    // `--version`, they read as options a newcomer is expected to understand,
    // and the first thing `xtctx --help` showed was two knobs for a mechanism
    // that is entirely internal.
    .addOption(new Option("--hook <event>", "Internal hook event name").hideHelp())
    .addOption(new Option("--tool <tool>", "Tool invoking an internal hook").hideHelp())
    .option("-p, --project <path>", "Project root");

  program.action(async () => {
    const options = program.opts<{ hook?: string; tool?: string; project?: string }>();
    if (options.hook) {
      await runHook({
        event: options.hook,
        tool: options.tool,
        projectPath: options.project,
      });
      return;
    }

    program.outputHelp();
  });

  await program.parseAsync(argv);
}

function shouldStartMcp(argv: string[]): boolean {
  if (argv.length > 2) {
    return false;
  }

  if (process.env.XTCTX_NO_AUTO_MCP === "1") {
    return false;
  }

  return process.stdin.isTTY !== true && process.stdout.isTTY !== true;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
