import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  RUNTIME_DIR_ENV,
  installRuntime,
  removeRuntime,
  runtimeLocation,
  type InstallDeps,
} from "../handoff/embedding-runtime.js";

interface EnableOptions {
  /** Skip the question. Required when stdin is not a terminal. */
  yes?: boolean;
  /** Home to install under; tests redirect it, production uses the user's. */
  home?: string;
  deps?: InstallDeps;
}

/**
 * Install the local embedding model, so search can match by meaning as well as
 * by keyword.
 *
 * It is an explicit step because it is not small: the runtime is several
 * hundred megabytes and the model another hundred, and putting that behind
 * `npx -y xtctx` made every cold start take tens of seconds to minutes before
 * the server could answer. Keyword search works without any of it.
 *
 * Asks first, like `setup`, and refuses to guess when nobody can answer:
 * `--yes` is how an agent or a script says it has already decided.
 */
export async function runEmbeddingsEnable(options: EnableOptions = {}): Promise<void> {
  const location = { home: options.home };
  const { dir, managed } = runtimeLocation(location);
  if (!managed) {
    process.stdout.write(
      `${RUNTIME_DIR_ENV} is set, so the local model is supplied from ${dir} and there is nothing to install.\n`,
    );
    return;
  }

  if (!options.yes) {
    process.stdout.write(
      "xtctx embeddings enable will download the local semantic-search runtime and model:\n" +
        `  into ${dir}\n` +
        "  from the npm registry (pinned and checked against a lockfile) and huggingface.co\n" +
        "  about 540 MB on disk, one time; nothing leaves this machine afterwards\n",
    );
    if (input.isTTY !== true || output.isTTY !== true) {
      throw new Error("Refusing non-interactive install without --yes.");
    }
    const rl = createInterface({ input, output });
    try {
      const answer = (await rl.question("Install it? [y/N] ")).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        process.stdout.write("xtctx embeddings enable cancelled.\n");
        return;
      }
    } finally {
      rl.close();
    }
  }

  const result = await installRuntime(location, {
    log: (line) => process.stdout.write(`${line}\n`),
    ...options.deps,
  });

  if (!result.installed) {
    process.stdout.write(`Semantic search is already enabled (runtime ${result.version} in ${result.dir}).\n`);
  } else {
    process.stdout.write(`Semantic search is enabled (runtime ${result.version} in ${result.dir}).\n`);
  }
  process.stdout.write(
    "Transcript windows are embedded in the background whenever the MCP server starts; `xtctx scan --embed`\n" +
      "does all of them now, however long that takes.\n",
  );
  if (process.env.XTCTX_DISABLE_EMBEDDINGS === "1") {
    process.stdout.write("Note: XTCTX_DISABLE_EMBEDDINGS=1 is set in this environment and still turns it off.\n");
  }
}

/** Remove the add-on. The index and the vectors already in it are left alone. */
export async function runEmbeddingsDisable(options: { home?: string } = {}): Promise<void> {
  const removed = await removeRuntime({ home: options.home });
  process.stdout.write(
    removed
      ? "Removed the local embedding runtime and model. Search is keyword only again; vectors already in the index are kept.\n"
      : "Semantic search was not enabled; nothing to remove.\n",
  );
}
