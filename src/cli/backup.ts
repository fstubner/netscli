import { createWriteStream, type WriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { once } from "node:events";
import { ExportFormatError } from "../handoff/export-file.js";
import { createProjectServices, type ProjectServices } from "../runtime/services.js";
import { readXtctxPackage } from "../utils/package-info.js";

/**
 * The same refusals `scan` makes. An unconfigured project has no index to
 * export and should not have one created by an import; an unreadable config
 * is not a project whose state anyone should be writing to.
 */
function refuseUnusable(services: ProjectServices, doing: string): boolean {
  if (!services.config.present) {
    process.stderr.write(
      `${services.projectRoot} is not configured for xtctx — nothing to ${doing}. Run \`xtctx setup\` first.\n`,
    );
    process.exitCode = 1;
    return true;
  }
  if (services.config.error) {
    process.stderr.write(
      `${services.configPath} could not be read (${services.config.error}); nothing to ${doing}.\n`,
    );
    process.exitCode = 1;
    return true;
  }
  return false;
}

function defaultExportName(): string {
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  return `xtctx-export-${stamp}.jsonl`;
}

async function writeTo(stream: WriteStream | NodeJS.WriteStream, line: string): Promise<void> {
  if (!stream.write(`${line}\n`)) {
    await once(stream, "drain");
  }
}

interface ExportOptions {
  projectPath?: string;
  /** A file path, or `-` for stdout. Defaults to a timestamped file in the current directory. */
  out?: string;
}

/**
 * Write this project's sessions and messages to a file that `xtctx import`
 * reads back. The index is the only copy of sessions whose transcripts have
 * been cleaned up, and this is the way to keep one somewhere else.
 *
 * Never overwrites. An export written over an older one could replace a
 * backup holding sessions that no longer exist anywhere with one that does
 * not, so an existing file is an error rather than a target. A file this
 * command started and could not finish is removed rather than left looking
 * like a backup.
 */
export async function runExport(options: ExportOptions = {}): Promise<void> {
  const services = await createProjectServices(options.projectPath, { createIfMissing: false });
  try {
    if (refuseUnusable(services, "export")) {
      return;
    }
    if (!services.sessions.exportSessions) {
      process.stderr.write("This index cannot export; nothing was written.\n");
      process.exitCode = 1;
      return;
    }

    const toStdout = options.out === "-";
    const target = toStdout ? null : resolve(options.out ?? defaultExportName());
    const stream = target ? createWriteStream(target, { flags: "wx" }) : process.stdout;
    if (target) {
      try {
        await once(stream, "open");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        process.stderr.write(
          code === "EEXIST"
            ? `${target} already exists; xtctx export never overwrites one. Pass --out with a new name.\n`
            : `Could not create ${target}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
        return;
      }
    }

    const { version } = readXtctxPackage(import.meta.url);
    try {
      const summary = await services.sessions.exportSessions((line) => writeTo(stream, line), {
        xtctxVersion: version,
      });
      if (target) {
        (stream as WriteStream).end();
        await once(stream, "close");
      }
      // To stderr when the export itself is on stdout, so a pipe gets only the file.
      (toStdout ? process.stderr : process.stdout).write(
        `Exported ${summary.sessions} session${summary.sessions === 1 ? "" : "s"} ` +
          `(${summary.messages} messages)${target ? ` to ${target}` : ""}.\n`,
      );
    } catch (error) {
      if (target) {
        (stream as WriteStream).destroy();
        await rm(target, { force: true }).catch(() => {});
      }
      process.stderr.write(
        `Export failed${target ? `; ${target} was removed` : ""}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  } finally {
    await services.sessions.close().catch(() => {});
  }
}

interface ImportOptions {
  projectPath?: string;
  file: string;
}

/**
 * Merge an `xtctx export` file into this project's index.
 *
 * Read-only on the file and on every transcript store: it writes to the
 * index and nothing else. Exits nonzero when anything in the file was not
 * imported, so a script restoring a backup can tell a partial restore from a
 * whole one.
 */
export async function runImport(options: ImportOptions): Promise<void> {
  const services = await createProjectServices(options.projectPath);
  try {
    if (refuseUnusable(services, "import into")) {
      return;
    }
    if (!services.sessions.importSessions) {
      process.stderr.write("This index cannot import; nothing was written.\n");
      process.exitCode = 1;
      return;
    }

    const path = resolve(options.file);
    let file;
    try {
      file = await open(path, "r");
    } catch (error) {
      process.stderr.write(
        `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      return;
    }
    // Created when iteration starts, not before. A readline interface starts
    // reading as soon as it exists and drops every line emitted before its
    // iterator is asked for, and the import awaits the index opening first:
    // passing `file.readLines()` directly imported nothing from a whole file.
    const handle = file;
    async function* lines(): AsyncIterable<string> {
      yield* handle.readLines({ encoding: "utf-8" });
    }
    let summary;
    try {
      summary = await services.sessions.importSessions(lines());
    } catch (error) {
      process.stderr.write(
        error instanceof ExportFormatError
          ? `${path}: ${error.message}. Nothing was imported.\n`
          : `Import from ${path} failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      return;
    } finally {
      await file.close().catch(() => {});
    }

    process.stdout.write(
      `Imported ${path}: ${summary.sessionsAdded} session${summary.sessionsAdded === 1 ? "" : "s"} added, ` +
        `${summary.sessionsUpdated} updated, ${summary.sessionsUnchanged} already present; ` +
        `${summary.messagesAdded} messages added.\n`,
    );
    for (const { line, reason } of summary.invalidLines) {
      process.stderr.write(`  line ${line} skipped: ${reason}\n`);
    }
    if (!summary.complete) {
      process.stderr.write(
        "  The file ends before its end line, so it was cut short: what it held was imported, " +
          "and anything after the cut was not.\n",
      );
    }
    if (summary.invalidLines.length > 0 || !summary.complete) {
      process.exitCode = 1;
    }
  } finally {
    await services.sessions.close().catch(() => {});
  }
}
