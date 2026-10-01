#!/usr/bin/env node
/**
 * Every tracked file belongs to exactly one review layer.
 *
 * Five audits of this repository each found a layer the previous one had not
 * looked at: code defects, then tests that could not fail, then release gates
 * that could not fail, then documentation and a landing page making claims the
 * code refuses. None of those passes was shallow. Each one was simply pointed
 * somewhere the last had not pointed, and nobody could say where that was,
 * because the list of places lived in whoever was reviewing.
 *
 * So the list lives here instead, and this script makes it answerable: a file
 * matching no layer fails, which turns "did we look everywhere" from a memory
 * question into a command. Adding a directory to the repository forces a
 * decision about who reviews it and what question they ask of it.
 *
 * It does NOT check that a review happened or was any good. It checks that the
 * map has no blank regions — the specific failure that recurred five times.
 *
 *   node scripts/check-review-coverage.mjs
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * @typedef {object} Layer
 * @property {string} name
 * @property {string} question  What a reviewer must ask of THIS layer.
 * @property {string} why       Why that question, and not the obvious one.
 * @property {RegExp[]} match   Paths this layer owns, repo-relative, POSIX.
 */

/**
 * The question is the load-bearing part.
 *
 * Asking "is this correct?" of a test suite finds nothing: a test that cannot
 * fail is perfectly correct. Asking "can this fail?" of the landing page finds
 * nothing either. Four of the five passes only worked because the question
 * changed with the layer, and the two that found the most were the two that
 * asked something other than "is there a bug".
 *
 * @type {Layer[]}
 */
const LAYERS = [
  {
    name: "product-source",
    question: "Is it correct? What input makes it do the wrong thing?",
    why: "The ordinary review. It is listed first so it is visibly not the only one.",
    match: [/^src\//],
  },
  {
    name: "test-suite",
    question:
      "Which of these would still pass if the code they cover were broken? Break the source and watch.",
    why:
      "Reading tests does not find this. Two were found only by hardcoding a value in the source " +
      "and seeing the suite stay green — one of them covering a feature that was broken at the time.",
    match: [/^tests\//, /^vitest\.config\.ts$/],
  },
  {
    name: "gates",
    question: "Can this fail? What makes it report success without having checked?",
    why:
      "`audit:production` reported a clean audit of a tree it had not read whenever the registry " +
      "was unreachable, because `--json` makes npm exit 0 on that failure.",
    match: [
      /^scripts\//,
      /^\.github\/workflows\//,
      // The baseline the upstream watcher compares against. Stale data here
      // makes the watcher quietly correct about nothing.
      /^\.github\/upstream-versions\.json$/,
    ],
  },
  {
    name: "published-artifacts",
    question: "Does this ship, and does it tell the truth to whatever reads it?",
    why:
      "The plugin's skill file is instructions to an agent. It promised retrieval without setup " +
      "while the server refuses every tool in an unconfigured project.",
    match: [/^plugin\//, /^\.claude-plugin\//, /^package\.json$/, /^package-lock\.json$/],
  },
  {
    name: "claims",
    question: "Is each statement true of the code as it is now? Cite the code, or mark it unverified.",
    why:
      "Prose drifts silently and nothing compiles it. Measured figures are the worst case: they " +
      "read as evidence while being untraceable to anything in the repository.",
    match: [
      // Root markdown, except the two that describe the site and are reviewed
      // with it. An overlap means neither layer owns the file, which is the
      // same blank region as no layer at all.
      /^(?!design-direction\.md$|ux-walkthrough\.md$)[^/]+\.md$/,
      /^docs\//,
      /^LICENSE$/,
      /^\.xtctx\//,
      // Written by xtctx into its own repository, and read by an agent — a
      // claim like any other, and the file nobody thought to review because
      // it lives under `.github`.
      /^\.github\/copilot-instructions\.md$/,
    ],
  },
  {
    name: "site",
    question: "Would a visitor believe something the product does not do?",
    why:
      "The landing page's central pitch was false in four places, and its JSON-LD published one " +
      "of them to search engines as structured data.",
    match: [/^landing\//, /^styles\//, /^design-tokens\.json$/, /^design-direction\.md$/, /^ux-walkthrough\.md$/],
  },
  {
    name: "build-config",
    question: "Does this do what the rest of the repository assumes it does?",
    why:
      "A `.gitignore` rule silently kept `plugin/.mcp.json` out of the published package, and two " +
      "of six clients registered no server.",
    match: [
      /^tsconfig.*\.json$/,
      /^eslint\.config\.js$/,
      /^\.npmrc$/,
      /^\.gitignore$/,
      /^\.gitattributes$/,
      /^\.github\/dependabot\.yml$/,
      // What `xtctx embeddings enable` installs. If `files` stops shipping it,
      // enable fails for every user, and nothing else notices.
      /^embeddings-runtime\//,
    ],
  },
];

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf-8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function layersFor(file) {
  return LAYERS.filter((layer) => layer.match.some((pattern) => pattern.test(file)));
}

export function reviewCoverage(files) {
  const unassigned = [];
  const overlapping = [];
  const counts = new Map(LAYERS.map((layer) => [layer.name, 0]));

  for (const file of files) {
    const owners = layersFor(file);
    if (owners.length === 0) {
      unassigned.push(file);
      continue;
    }
    if (owners.length > 1) {
      overlapping.push(`${file} -> ${owners.map((owner) => owner.name).join(", ")}`);
      continue;
    }
    counts.set(owners[0].name, (counts.get(owners[0].name) ?? 0) + 1);
  }

  // A layer that owns nothing is a layer nobody will think to review, and it
  // is usually a rename nobody followed through.
  const empty = [...counts.entries()].filter(([, count]) => count === 0).map(([name]) => name);

  return { unassigned, overlapping, empty, counts };
}

export { LAYERS };

// `pathToFileURL`, because a Windows path is not a file URL with its slashes
// swapped — the drive letter needs encoding. A hand-built comparison here made
// this script a silent no-op that still exited 0, which is the exact failure
// the `gates` layer below exists to ask about.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { unassigned, overlapping, empty, counts } = reviewCoverage(trackedFiles());
  const problems = [];

  if (unassigned.length > 0) {
    problems.push(
      `${unassigned.length} tracked file(s) belong to no review layer:\n` +
        unassigned.map((file) => `  ${file}`).join("\n") +
        "\n\nAdd them to a layer in this file, and say which question that layer asks of them.",
    );
  }
  if (overlapping.length > 0) {
    problems.push(
      `${overlapping.length} file(s) match more than one layer, so neither owns them:\n` +
        overlapping.map((entry) => `  ${entry}`).join("\n"),
    );
  }
  if (empty.length > 0) {
    problems.push(`Layer(s) matching nothing: ${empty.join(", ")}`);
  }

  if (problems.length > 0) {
    console.error(problems.join("\n\n"));
    process.exitCode = 1;
  } else {
    for (const layer of LAYERS) {
      console.log(`${String(counts.get(layer.name)).padStart(4)}  ${layer.name}`);
      console.log(`      ${layer.question}`);
    }
    console.log(`\nEvery tracked file belongs to exactly one of ${LAYERS.length} review layers.`);
  }
}
