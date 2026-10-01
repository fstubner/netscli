/**
 * The local embedding model is an add-on, not a dependency.
 *
 * `@huggingface/transformers` and the ONNX runtimes under it were 633MB of the
 * install, fetched before `npx -y xtctx` could print anything, for a feature
 * most installs never switched on. A cold first `--help` took 97 seconds and
 * server starts through npx 17.8 to 147.9, past what an MCP client waits.
 *
 * Moving it to `optionalDependencies` would not have helped, because npm
 * installs those by default. So these tests pin the mechanism rather than a
 * package.json field: nothing in the shipped source names the library as an
 * import, it is not in the dependency lists, and the only way it arrives is
 * `xtctx embeddings enable` installing a pinned, lockfile-checked copy into the
 * user's own directory.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEmbeddingsDisable, runEmbeddingsEnable } from "@xtctx/cli/embeddings";
import {
  RUNTIME_DIR_ENV,
  importTransformers,
  installRuntime,
  isRuntimeInstalled,
  removeRuntime,
  runtimeLocation,
  runtimeTemplateDir,
} from "@xtctx/handoff/embedding-runtime";

const REPO = process.cwd();
const PACKAGE_DIR = join("node_modules", "@huggingface", "transformers");

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

describe("the default install has no ML runtime", () => {
  it("imports @huggingface/transformers nowhere in the shipped source", async () => {
    // Any import form, static or dynamic. A dynamic `import("@huggingface/…")`
    // is what this used to be, and it is a dependency all the same: npm
    // installs the package so the import can resolve.
    const forms = [
      /from\s+["']@huggingface\/transformers/,
      /import\s*\(\s*["']@huggingface\/transformers/,
      /require\s*\(\s*["']@huggingface\/transformers/,
      /import\s+["']@huggingface\/transformers/,
    ];
    const offenders: string[] = [];
    for (const file of await sourceFiles(join(REPO, "src"))) {
      const text = await readFile(file, "utf-8");
      if (forms.some((form) => form.test(text))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("is not a runtime dependency of the package, optional or otherwise", async () => {
    const manifest = JSON.parse(await readFile(join(REPO, "package.json"), "utf-8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      expect(Object.keys(manifest[field] ?? {}), field).not.toContain("@huggingface/transformers");
    }
  });

  it("ships the pinned manifest and lockfile that enable installs from", async () => {
    const files = (JSON.parse(await readFile(join(REPO, "package.json"), "utf-8")) as { files: string[] }).files;
    expect(files).toContain("embeddings-runtime");

    const template = runtimeTemplateDir();
    const manifest = JSON.parse(await readFile(join(template, "package.json"), "utf-8")) as {
      dependencies: Record<string, string>;
    };
    // Exact, not a range: the version is chosen by this release, not by what
    // the registry holds on the day somebody enables it.
    expect(manifest.dependencies["@huggingface/transformers"]).toMatch(/^\d+\.\d+\.\d+$/);

    const lock = JSON.parse(await readFile(join(template, "package-lock.json"), "utf-8")) as {
      packages: Record<string, { version?: string; integrity?: string; link?: boolean }>;
    };
    const entries = Object.entries(lock.packages).filter(([path]) => path !== "");
    expect(entries.length).toBeGreaterThan(10);
    // Every package is checked against an integrity hash when `npm ci` installs it.
    expect(entries.filter(([, entry]) => !entry.integrity).map(([path]) => path)).toEqual([]);
    expect(lock.packages["node_modules/@huggingface/transformers"]?.version).toBe(
      manifest.dependencies["@huggingface/transformers"],
    );
  });
});

describe("xtctx embeddings enable", () => {
  let home = "";

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "xtctx-runtime-home-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  /** An npm that "installs" by creating the package, and records how it was called. */
  function fakeNpm() {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    return {
      calls,
      runNpm: async (args: string[], cwd: string) => {
        calls.push({ args, cwd });
        const manifest = join(cwd, PACKAGE_DIR, "package.json");
        await mkdir(dirname(manifest), { recursive: true });
        await writeFile(manifest, "{}", "utf-8");
      },
    };
  }

  it("is off before it has been run", () => {
    expect(isRuntimeInstalled({ home, env: {} })).toBe(false);
  });

  it("installs the pinned runtime into the per-user directory with npm ci", async () => {
    const npm = fakeNpm();
    const prefetched: string[] = [];

    const result = await installRuntime(
      { home, env: {} },
      { runNpm: npm.runNpm, prefetchModel: async () => void prefetched.push("model") },
    );

    const dir = join(home, ".xtctx", "embeddings");
    expect(result).toMatchObject({ dir, installed: true });
    // `ci`, from the lockfile that ships with this release, with no scripts.
    expect(npm.calls).toHaveLength(1);
    expect(npm.calls[0].cwd).toBe(dir);
    expect(npm.calls[0].args.slice(0, 2)).toEqual(["ci", "--ignore-scripts"]);
    expect(await readFile(join(dir, "package-lock.json"), "utf-8")).toBe(
      await readFile(join(runtimeTemplateDir(), "package-lock.json"), "utf-8"),
    );
    expect(prefetched).toEqual(["model"]);
    expect(isRuntimeInstalled({ home, env: {} })).toBe(true);
  });

  it("does not count an interrupted install as enabled", async () => {
    // npm died after unpacking part of the tree. The package.json is there; the
    // runtime is not usable, and the marker is what says it finished.
    const failing = async (_args: string[], cwd: string) => {
      const manifest = join(cwd, PACKAGE_DIR, "package.json");
      await mkdir(dirname(manifest), { recursive: true });
      await writeFile(manifest, "{}", "utf-8");
      throw new Error("npm ci exited with code 1");
    };

    await expect(
      installRuntime({ home, env: {} }, { runNpm: failing, prefetchModel: async () => {} }),
    ).rejects.toThrow("exited with code 1");

    expect(isRuntimeInstalled({ home, env: {} })).toBe(false);
  });

  it("does not leave it half-enabled when the model cannot be fetched", async () => {
    const npm = fakeNpm();

    await expect(
      installRuntime(
        { home, env: {} },
        {
          runNpm: npm.runNpm,
          prefetchModel: async () => {
            throw new Error("getaddrinfo ENOTFOUND huggingface.co");
          },
        },
      ),
    ).rejects.toThrow("huggingface.co");

    expect(isRuntimeInstalled({ home, env: {} })).toBe(false);
  });

  it("does nothing the second time, and reinstalls when the pinned version moved", async () => {
    const npm = fakeNpm();
    const deps = { runNpm: npm.runNpm, prefetchModel: async () => {} };
    await installRuntime({ home, env: {} }, deps);

    const again = await installRuntime({ home, env: {} }, deps);
    expect(again.installed).toBe(false);
    expect(npm.calls).toHaveLength(1);

    // An older release's install, with a newer xtctx now shipping a different pin.
    await writeFile(
      join(home, ".xtctx", "embeddings", "installed.json"),
      JSON.stringify({ version: "0.0.1" }),
      "utf-8",
    );
    const upgraded = await installRuntime({ home, env: {} }, deps);
    expect(upgraded.installed).toBe(true);
    expect(npm.calls).toHaveLength(2);
  });

  it("is undone by disable, which leaves everything outside the add-on alone", async () => {
    await mkdir(join(home, ".xtctx"), { recursive: true });
    await writeFile(join(home, ".xtctx", "device.json"), "{}", "utf-8");
    const npm = fakeNpm();
    await installRuntime({ home, env: {} }, { runNpm: npm.runNpm, prefetchModel: async () => {} });

    expect(await removeRuntime({ home, env: {} })).toBe(true);
    expect(isRuntimeInstalled({ home, env: {} })).toBe(false);
    expect(existsSync(join(home, ".xtctx", "device.json"))).toBe(true);
    expect(await removeRuntime({ home, env: {} })).toBe(false);
  });

  it("refuses to run unattended without --yes, and does not touch the network", async () => {
    const npm = fakeNpm();
    vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write);
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    try {
      await expect(
        runEmbeddingsEnable({ home, deps: { runNpm: npm.runNpm, prefetchModel: async () => {} } }),
      ).rejects.toThrow("--yes");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: tty, configurable: true });
    }
    expect(npm.calls).toHaveLength(0);
  });

  it("installs and says so with --yes, then disable removes it", async () => {
    const npm = fakeNpm();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    await runEmbeddingsEnable({
      yes: true,
      home,
      deps: { runNpm: npm.runNpm, prefetchModel: async () => {} },
    });
    expect(out.join("")).toContain("Semantic search is enabled");
    expect(npm.calls).toHaveLength(1);
    expect(isRuntimeInstalled({ home, env: {} })).toBe(true);

    await runEmbeddingsDisable({ home });
    expect(isRuntimeInstalled({ home, env: {} })).toBe(false);
    expect(out.join("")).toContain("Removed the local embedding runtime");
  });
});

describe("loading the runtime", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xtctx-runtime-load-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("imports the library from the runtime directory, not from this package", async () => {
    const pkg = join(dir, PACKAGE_DIR);
    await mkdir(join(pkg, "dist"), { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "@huggingface/transformers",
        type: "module",
        exports: { node: { import: { default: "./dist/entry.mjs" } } },
      }),
      "utf-8",
    );
    await writeFile(join(pkg, "dist", "entry.mjs"), "export const pipeline = 'from the runtime dir';\n", "utf-8");

    const env = { [RUNTIME_DIR_ENV]: dir };
    expect(runtimeLocation({ env }).dir).toBe(dir);
    expect(isRuntimeInstalled({ env })).toBe(true);
    expect(((await importTransformers({ env })) as { pipeline: string }).pipeline).toBe(
      "from the runtime dir",
    );
  });

  it("says how to enable it when it is missing", async () => {
    await expect(importTransformers({ home: dir, env: {} })).rejects.toThrow("xtctx embeddings enable");
  });
});
