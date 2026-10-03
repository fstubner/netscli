#!/usr/bin/env node
/**
 * `npm audit --omit=dev`, with room for advisories that have no fix and no
 * reach into this program.
 *
 * The bare command is all-or-nothing: any advisory against any package in the
 * production tree fails the build, whether or not xtctx ever executes the code
 * it describes. That is the right default and it stays the default here —
 * every advisory fails unless it is listed below with a reason.
 *
 * What this is not: a way to make a warning quiet. An entry states which
 * advisory, why the vulnerable path is unreachable from this program, and what
 * would remove the need for the entry. If that argument cannot be written, the
 * advisory is not eligible and the dependency has to change instead.
 *
 * Stale entries fail too. An allowlisted advisory that no longer appears means
 * the dependency moved on, and the exception has to go with it — otherwise the
 * list silently accumulates permission nobody re-examined.
 */
import { spawnSync } from "node:child_process";

/**
 * @typedef {object} Exception
 * @property {string} advisory   GHSA identifier, as npm reports it.
 * @property {string} package    Package the advisory is filed against.
 * @property {string} why        Why this program cannot reach the vulnerable path.
 * @property {string} removedBy  What would let this entry be deleted.
 */

/** @type {Exception[]} */
const PRODUCTION_EXCEPTIONS = [];

/**
 * The landing site (`landing/`, run with `--landing`). It has only
 * devDependencies, all of them build tooling for a static site served as
 * files, so its whole tree is audited, under the same rules.
 *
 * @type {Exception[]}
 */
const LANDING_EXCEPTIONS = [
  {
    advisory: "GHSA-ch52-4w7c-c8xp",
    package: "http-cache-semantics",
    why:
      "Only astro's build-time remote-image fetcher imports it (astro 7.3.3 dist/assets/build/remote.js, " +
      "the sole import in its dist), and the landing site uses no remote images: no astro:assets imports, " +
      "no <Image>/<Picture>, no image config in astro.config.mjs. The advisory concerns a shared cache " +
      "serving one user's response to another; the site is static files with no server and no cache of its own.",
    removedBy: "A fixed http-cache-semantics (every version is affected as of 2026-10-03), or astro dropping it.",
  },
];

const LANDING = process.argv.includes("--landing");
const EXCEPTIONS = LANDING ? LANDING_EXCEPTIONS : PRODUCTION_EXCEPTIONS;
const AUDIT_COMMAND = LANDING ? "npm --prefix landing audit --json" : "npm audit --omit=dev --json";
const SCOPE = LANDING ? "Landing site dependency" : "Production dependency";

/**
 * npm reports one entry per package along the chain, so a single advisory
 * against a leaf also surfaces against everything that depends on it. Matching
 * on the advisory identifier rather than the package name keeps one exception
 * to one real finding, instead of needing an entry per hop.
 */
function advisoriesInReport(report) {
  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      // A string `via` is a pointer to another package's entry, not an
      // advisory of its own; the object form carries the identifier.
      if (typeof via !== "object" || typeof via.url !== "string") {
        continue;
      }
      const id = via.url.split("/").pop();
      if (!id) {
        continue;
      }
      if (!found.has(id)) {
        found.set(id, { id, title: via.title ?? "", severity: via.severity ?? "unknown", url: via.url });
      }
    }
  }
  return found;
}

function runAudit() {
  // `npm audit` exits non-zero when it finds something, which is the whole
  // point, so the exit code is not an error signal here — an unparseable body
  // is.
  // One command string rather than a name plus an argument array. npm is a
  // shell script on every platform this runs on (`npm.cmd` on Windows), so it
  // cannot be spawned without a shell — but passing an array *through* a shell
  // concatenates rather than escapes, which Node deprecates in DEP0190. Every
  // argument here is a literal in this file, so there is nothing to escape.
  const result = spawnSync(AUDIT_COMMAND, {
    encoding: "utf-8",
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`could not run npm audit: ${result.error.message}`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `npm audit did not return JSON.\nstdout: ${result.stdout.slice(0, 2000)}\nstderr: ${result.stderr.slice(0, 2000)}`,
    );
  }

  // Parsing is not the same as auditing. With `--json`, an npm that cannot
  // reach the registry prints an error OBJECT and exits 0 — so the body parses,
  // carries no `vulnerabilities`, and every check below finds nothing wrong.
  // This gate then reported "audit clean" for a tree it had not looked at, and
  // `verify:release` passed on it. Reproduced with
  // `npm_config_registry=http://127.0.0.1:9`: clean, exit 0. Bare `npm audit`
  // exits 1 on the same failure; adding `--json` is what inverted it.
  //
  // A security gate has to fail closed: not knowing is not the same as knowing
  // there is nothing.
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    throw new Error(`npm audit returned ${typeof report}, not a report object.`);
  }
  if (report.error) {
    const fields =
      typeof report.error === "object" && report.error !== null
        ? [report.error.summary, report.error.detail, JSON.stringify(report.error)]
        : [String(report.error)];
    // npm fills some of these with an empty string rather than omitting them,
    // so pick the first that carries text instead of the first that is defined.
    const detail = fields.find((value) => typeof value === "string" && value.trim() !== "");
    throw new Error(
      `npm audit could not complete: ${String(detail ?? "npm reported an error with no detail").slice(0, 2000)}\n` +
        `stderr: ${result.stderr.slice(0, 1000)}`,
    );
  }
  if (typeof report.vulnerabilities !== "object" || report.vulnerabilities === null) {
    throw new Error(
      "npm audit returned no `vulnerabilities` section, so nothing was audited.\n" +
        `stdout: ${result.stdout.slice(0, 2000)}`,
    );
  }

  return report;
}

function main() {
  const report = runAudit();
  const found = advisoriesInReport(report);
  const allowed = new Map(EXCEPTIONS.map((entry) => [entry.advisory, entry]));

  const unexpected = [...found.values()].filter((advisory) => !allowed.has(advisory.id));
  const stale = EXCEPTIONS.filter((entry) => !found.has(entry.advisory));

  for (const entry of EXCEPTIONS) {
    if (found.has(entry.advisory)) {
      const advisory = found.get(entry.advisory);
      process.stdout.write(`allowed: ${entry.advisory} (${entry.package}, ${advisory.severity}) — ${entry.why.split(".")[0]}.\n`);
    }
  }

  if (stale.length > 0) {
    process.stderr.write("\nThese exceptions no longer match any advisory. Delete them:\n");
    for (const entry of stale) {
      process.stderr.write(`  ${entry.advisory} (${entry.package})\n`);
    }
  }

  if (unexpected.length > 0) {
    process.stderr.write(`\n${SCOPE} advisories with no exception:\n`);
    for (const advisory of unexpected) {
      process.stderr.write(`  ${advisory.severity.padEnd(8)} ${advisory.id}  ${advisory.title}\n    ${advisory.url}\n`);
    }
    process.stderr.write(
      "\nFix it, or add an exception to scripts/audit-production.mjs stating why\n" +
        `the vulnerable path is unreachable from ${LANDING ? "the landing build" : "xtctx"} and what would remove the\n` +
        "exception. An advisory nobody can write that argument for is not eligible.\n",
    );
  }

  if (unexpected.length > 0 || stale.length > 0) {
    process.exit(1);
  }

  process.stdout.write(
    `${SCOPE} audit clean (${found.size} advisory/advisories, all accounted for).\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
