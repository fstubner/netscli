import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The local embedding runtime, and where it lives.
 *
 * It is NOT a dependency of this package, and that is the point of the file.
 * `@huggingface/transformers` pulls in onnxruntime-node (~212MB),
 * onnxruntime-web (~161MB) and itself (~174MB): 633MB measured, plus a ~106MB
 * model on the first server start. `npx -y xtctx` and the plugin's MCP command
 * both install every dependency before running anything, so a cold start took
 * 17.8 to 147.9 seconds through npx and a first `--help` 97 — past what an MCP
 * client waits for a server to answer — to enable a feature most installs never
 * used.
 *
 * `optionalDependencies` would not have helped: npm installs those by default
 * too. So the runtime is installed on demand, by `xtctx embeddings enable`,
 * into a per-user directory (`~/.xtctx/embeddings`) and loaded from there by
 * path. That directory is also where the model downloads to, which makes it
 * persist across npx cache evictions — the old arrangement re-fetched 106MB
 * every time npx dropped its cache.
 *
 * What is installed is not whatever npm resolves on the day. The package ships
 * `embeddings-runtime/package.json` and a lockfile beside it, and `enable` runs
 * `npm ci` against them, so the version and every integrity hash are pinned by
 * this release rather than by the user's registry at that moment.
 */

/**
 * Points at a directory that already has the runtime in its `node_modules`.
 *
 * For development and tests, where the repository root has it as a
 * devDependency and nothing should install a second copy. Treated as enabled
 * whenever the package is actually there.
 */
export const RUNTIME_DIR_ENV = "XTCTX_EMBEDDING_RUNTIME_DIR";

/**
 * What status output says to someone who wants semantic search. One string, so
 * the CLI and the MCP tool cannot drift apart on the command or the cost.
 */
export const ENABLE_SEMANTIC_HINT =
  "run `xtctx embeddings enable` (downloads the local model and its runtime, about 540 MB on disk)";

const PACKAGE = "@huggingface/transformers";
const MARKER = "installed.json";

interface Location {
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RuntimeLocation {
  dir: string;
  /** Installed by `xtctx embeddings enable`, as opposed to pointed at by the environment. */
  managed: boolean;
}

export function runtimeLocation({ home, env = process.env }: Location = {}): RuntimeLocation {
  const override = env[RUNTIME_DIR_ENV]?.trim();
  if (override) {
    return { dir: override, managed: false };
  }
  // User-level, like the device verdict: a second project on the same machine
  // has already paid for it.
  return { dir: join(home ?? homedir(), ".xtctx", "embeddings"), managed: true };
}

function packageJsonPath(dir: string): string {
  return join(dir, "node_modules", ...PACKAGE.split("/"), "package.json");
}

/**
 * Whether the runtime can be loaded.
 *
 * A managed install counts only once its marker exists, and the marker is
 * written last: an `npm ci` that was interrupted leaves a half-populated
 * `node_modules` that would otherwise read as enabled and fail on first load.
 */
export function isRuntimeInstalled(location: Location = {}): boolean {
  const { dir, managed } = runtimeLocation(location);
  if (!existsSync(packageJsonPath(dir))) {
    return false;
  }
  return !managed || existsSync(join(dir, MARKER));
}

/** Pulls in the real library. Only ever reached from `embeddings.ts` and the calibration worker. */
export async function importTransformers(location: Location = {}): Promise<unknown> {
  const { dir } = runtimeLocation(location);
  const manifestPath = packageJsonPath(dir);
  let entry: string;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
      exports?: { node?: { import?: { default?: string } } };
    };
    const relative = manifest.exports?.node?.import?.default;
    if (!relative) {
      throw new Error("its package.json has no node ESM entry point");
    }
    entry = join(dirname(manifestPath), relative);
  } catch (error) {
    throw new Error(
      `the local embedding runtime is not installed (${error instanceof Error ? error.message : String(error)}). ` +
        "Run `xtctx embeddings enable`.",
    );
  }
  return import(pathToFileURL(entry).href);
}

/** Version the installed runtime was built from, or null. */
export async function installedRuntimeVersion(location: Location = {}): Promise<string | null> {
  try {
    const marker = JSON.parse(await readFile(join(runtimeLocation(location).dir, MARKER), "utf-8")) as {
      version?: string;
    };
    return typeof marker.version === "string" ? marker.version : null;
  } catch {
    return null;
  }
}

/** Where this release keeps the package.json and lockfile it installs from. */
export function runtimeTemplateDir(moduleUrl = import.meta.url): string {
  let dir = dirname(fileURLToPath(moduleUrl));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, "embeddings-runtime");
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the embeddings-runtime directory from ${moduleUrl}`);
}

export interface InstallDeps {
  /** Runs `npm <args>` in `cwd`; rejects on a nonzero exit. */
  runNpm?: (args: string[], cwd: string) => Promise<void>;
  /** Fetches the model into the runtime's cache, so the first search does not. */
  prefetchModel?: (location: Location) => Promise<void>;
  log?: (line: string) => void;
}

export interface InstallResult {
  dir: string;
  version: string;
  /** False when the pinned version was already installed and nothing was done. */
  installed: boolean;
}

/**
 * Install the pinned runtime and fetch the model.
 *
 * `--ignore-scripts` is deliberate and is not a workaround. The one install
 * script in the tree is onnxruntime-node's, and on Linux x64 it downloads CUDA
 * provider binaries that xtctx never asks for (the devices it times are `cpu`,
 * `dml` and `webgpu`). Running arbitrary lifecycle scripts as a side effect of
 * a command that fetches 400MB is not a trade worth making for that.
 */
export async function installRuntime(
  location: Location = {},
  deps: InstallDeps = {},
): Promise<InstallResult> {
  const log = deps.log ?? (() => {});
  const { dir, managed } = runtimeLocation(location);
  if (!managed) {
    throw new Error(
      `${RUNTIME_DIR_ENV} is set, so the runtime is managed outside xtctx. Unset it to install one here.`,
    );
  }

  const template = runtimeTemplateDir();
  const manifest = JSON.parse(await readFile(join(template, "package.json"), "utf-8")) as {
    dependencies?: Record<string, string>;
  };
  const version = manifest.dependencies?.[PACKAGE];
  if (!version) {
    throw new Error(`${join(template, "package.json")} does not pin ${PACKAGE}`);
  }

  if (isRuntimeInstalled(location) && (await installedRuntimeVersion(location)) === version) {
    return { dir, version, installed: false };
  }

  await rm(join(dir, MARKER), { force: true });
  await mkdir(dir, { recursive: true });
  await copyFile(join(template, "package.json"), join(dir, "package.json"));
  await copyFile(join(template, "package-lock.json"), join(dir, "package-lock.json"));

  log(`Installing ${PACKAGE}@${version} into ${dir} ...`);
  const runNpm = deps.runNpm ?? defaultRunNpm;
  await runNpm(["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], dir);
  if (!isRuntimeInstalledIgnoringMarker(dir)) {
    throw new Error(`npm finished but ${PACKAGE} is not in ${join(dir, "node_modules")}`);
  }

  log("Fetching the embedding model ...");
  await (deps.prefetchModel ?? defaultPrefetchModel)(location);

  await writeFile(
    join(dir, MARKER),
    `${JSON.stringify({ version, installedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf-8",
  );
  return { dir, version, installed: true };
}

function isRuntimeInstalledIgnoringMarker(dir: string): boolean {
  return existsSync(packageJsonPath(dir));
}

/** Delete the managed runtime and its model cache. Returns whether anything was there. */
export async function removeRuntime(location: Location = {}): Promise<boolean> {
  const { dir, managed } = runtimeLocation(location);
  if (!managed) {
    throw new Error(
      `${RUNTIME_DIR_ENV} is set, so the runtime is managed outside xtctx and is not removed here.`,
    );
  }
  const existed = existsSync(dir);
  await rm(dir, { recursive: true, force: true });
  return existed;
}

async function defaultPrefetchModel(location: Location): Promise<void> {
  // Imported here, not at the top: this module is loaded on every start, and
  // `embeddings.ts` is where the model identity lives.
  const { DEFAULT_EMBEDDING_DTYPE, DEFAULT_EMBEDDING_MODEL } = await import("./embeddings.js");
  const transformers = (await importTransformers(location)) as {
    pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<unknown>;
  };
  await transformers.pipeline("feature-extraction", DEFAULT_EMBEDDING_MODEL, {
    dtype: DEFAULT_EMBEDDING_DTYPE,
  });
}

/**
 * npm, found without trusting PATH to have the right one.
 *
 * `npm_execpath` is set when xtctx was started by npm or npx, which is how the
 * plugin starts it. Otherwise the npm bundled with this Node, then whatever is
 * on PATH. `.cmd` shims cannot be spawned directly on Windows, hence the shell
 * for that last case only; the arguments are fixed strings, none of them user
 * input.
 */
function defaultRunNpm(args: string[], cwd: string): Promise<void> {
  const [command, prefix, shell] = npmInvocation();
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...prefix, ...args], { cwd, stdio: "inherit", shell });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args[0]} exited with code ${code}`));
    });
  });
}

function npmInvocation(): [string, string[], boolean] {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && /npm-cli\.c?js$/.test(fromEnv) && existsSync(fromEnv)) {
    return [process.execPath, [fromEnv], false];
  }
  const nodeDir = dirname(process.execPath);
  for (const candidate of [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ]) {
    if (existsSync(candidate)) {
      return [process.execPath, [candidate], false];
    }
  }
  return ["npm", [], process.platform === "win32"];
}
