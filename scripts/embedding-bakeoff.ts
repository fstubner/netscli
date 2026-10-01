/**
 * Score an embedding model against the eval corpus, at several thresholds.
 *
 * `docs/embedding-performance.md` records a bake-off that found bge-small
 * beating MiniLM once each model is judged at its own thresholds, and says
 * plainly that those rows cannot be reproduced: they were measured with
 * scratch scripts against a temporarily patched constant, and the eval harness
 * "runs one fixed provider and has no way to select a model or vary a
 * threshold". That made the strongest result in the file the least checkable
 * thing in it.
 *
 * This is that missing harness. It reuses the eval's own corpus and scoring so
 * a row here is comparable with `tests/eval/results/ranking-baseline.json`,
 * which is also the control: running this on the default model at the default
 * thresholds must reproduce the committed baseline, or the two are measuring
 * different things and nothing else here can be trusted.
 *
 * The thresholds sweep for free. They are applied at query time, not at embed
 * time, so one indexing pass per model serves every threshold pair — which is
 * what makes a sweep affordable at all, since embedding the corpus is the
 * expensive part.
 *
 * ONE MODEL PER PROCESS. Two providers in one process fail intermittently with
 * `bad allocation`, and two in separate vitest workers killed a worker
 * outright (issue #101).
 *
 *   npx tsx scripts/embedding-bakeoff.ts --model=Xenova/all-MiniLM-L6-v2
 *   npx tsx scripts/embedding-bakeoff.ts --model=Xenova/bge-small-en-v1.5
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SqliteHandoffIndex } from "../src/handoff/sqlite-index.js";
import { TransformersEmbeddingProvider } from "../src/handoff/embeddings.js";
import type { SessionSearchMode } from "../src/handoff/types.js";
import type { ConversationChunk, ConversationScraper, ScraperState } from "../src/types/scraper.js";
import { generateCorpus, type Anchor, type NegativeQuery } from "../tests/eval/corpus.js";

// The library is an add-on loaded from a runtime directory; run from the
// repository root, which has it as a devDependency.
process.env.XTCTX_EMBEDDING_RUNTIME_DIR ??= process.cwd();

const MODES: SessionSearchMode[] = ["hybrid", "vector", "keyword"];

/**
 * Threshold pairs to try, as (minSemanticCosine, minConfidentCosine).
 *
 * The spread is wide because the thing being measured is that it has to be:
 * bge-small and gte-small both scored a false-positive rate of 1.00 at
 * MiniLM's 0.15/0.36 — every deliberately unanswerable query, gibberish
 * included, returned something. They are not worse models; they place their
 * cosine values higher, so a floor tuned to one model's distribution stops
 * excluding anything on another's.
 */
const SWEEP: Array<[number, number]> = [
  [0.15, 0.36],
  [0.25, 0.45],
  [0.35, 0.55],
  [0.45, 0.55],
  [0.55, 0.65],
  [0.65, 0.75],
  [0.75, 0.85],
];

/** Replays a fixed set of chunks; the corpus, not the scraper, is under test. */
class CorpusScraper implements ConversationScraper {
  constructor(
    readonly tool: string,
    private readonly chunks: ConversationChunk[],
  ) {}

  async detect(): Promise<boolean> {
    return true;
  }

  getStorePaths(): string[] {
    return [`corpus://${this.tool}`];
  }

  async *scrape(): AsyncIterable<ConversationChunk> {
    yield* this.fullSync();
  }

  async *fullSync(): AsyncIterable<ConversationChunk> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }

  async getLastScrapedPosition(): Promise<ScraperState> {
    return { lastTimestamp: new Date(0) };
  }

  async saveScrapedPosition(): Promise<void> {
    return;
  }
}

interface Metrics {
  mrr: number;
  recallAt5: number;
  top1: number;
  falsePositiveRate: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Identical arithmetic to `score` in ranking.eval.test.ts, so rows compare. */
function score(ranks: Array<number | null>, unanswerable: number[]): Metrics {
  const found = ranks.filter((rank): rank is number => rank !== null);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  return {
    mrr: round(sum(found.map((rank) => 1 / rank)) / ranks.length),
    recallAt5: round(found.filter((rank) => rank <= 5).length / ranks.length),
    top1: round(found.filter((rank) => rank === 1).length / ranks.length),
    falsePositiveRate:
      unanswerable.length === 0
        ? 0
        : round(unanswerable.filter((count) => count > 0).length / unanswerable.length),
  };
}

async function measure(
  dbPath: string,
  projectRoot: string,
  tools: Array<{ tool: string; scraper: ConversationScraper }>,
  provider: TransformersEmbeddingProvider,
  anchors: Anchor[],
  negatives: NegativeQuery[],
  thresholds: [number, number],
): Promise<Record<string, Metrics>> {
  const index = new SqliteHandoffIndex(dbPath, projectRoot, tools, {
    embeddingProvider: provider,
    refreshBudgetMs: 600_000,
    vectorBudgetMs: 600_000,
    minSemanticCosine: thresholds[0],
    minConfidentCosine: thresholds[1],
  });

  try {
    const report: Record<string, Metrics> = {};
    for (const mode of MODES) {
      const ranks: Array<number | null> = [];
      for (const anchor of anchors) {
        const results = await index.searchSessions(anchor.query, 10, undefined, mode);
        const position = results.findIndex((session) => session.session_ref === anchor.sessionRef);
        ranks.push(position === -1 ? null : position + 1);
      }

      // Only the genuinely unanswerable ones. The eval separates "related
      // topic" queries and reports them without policing them, on the grounds
      // that offering cache warming for a question about cache eviction is
      // arguable rather than wrong — counting those as false positives once
      // sent two rounds of work at a defect that was not there.
      const unanswerable: number[] = [];
      for (const negative of negatives) {
        if (negative.kind === "related") continue;
        const results = await index.searchSessions(negative.query, 10, undefined, mode);
        unanswerable.push(results.length);
      }

      report[mode] = score(ranks, unanswerable);
    }
    return report;
  } finally {
    await index.close();
  }
}

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "Xenova/all-MiniLM-L6-v2" },
    /** `--sweep=0.46:0.56,0.50:0.60` to look closely at one region. */
    sweep: { type: "string" },
  },
  strict: false,
});
const model = String(values.model);
const sweep: Array<[number, number]> = values.sweep
  ? String(values.sweep)
      .split(",")
      .map((pair) => {
        const [semantic, confident] = pair.split(":").map(Number);
        if (!Number.isFinite(semantic) || !Number.isFinite(confident)) {
          throw new Error(`--sweep expects pairs like 0.55:0.65, got ${JSON.stringify(pair)}`);
        }
        return [semantic, confident] as [number, number];
      })
  : SWEEP;

const tempDir = await mkdtemp(join(tmpdir(), "xtctx-bakeoff-"));
try {
  const corpus = generateCorpus();
  const byTool = new Map<string, ConversationChunk[]>();
  for (const chunk of corpus.chunks) {
    byTool.set(chunk.tool, [...(byTool.get(chunk.tool) ?? []), chunk]);
  }
  const tools = [...byTool.entries()].map(([tool, chunks]) => ({
    tool,
    scraper: new CorpusScraper(tool, chunks) as ConversationScraper,
  }));

  const provider = new TransformersEmbeddingProvider(model);
  const dbPath = join(tempDir, "bakeoff.db");

  // Index and embed once. Every threshold below reads these same vectors.
  process.stderr.write(`indexing the corpus under ${model}...\n`);
  const indexedAt = Date.now();
  const warm = new SqliteHandoffIndex(dbPath, tempDir, tools, {
    embeddingProvider: provider,
    refreshBudgetMs: 600_000,
    vectorBudgetMs: 600_000,
  });
  await warm.listRecentSessions(1);
  // `vector` rather than the default: hybrid deliberately answers from keyword
  // while the model loads, so warming through it would leave the model cold.
  await warm.searchSessions("warm the embedding model", 1, undefined, "vector");
  await warm.embedBacklog?.();
  await warm.close();
  const indexMs = Date.now() - indexedAt;

  process.stdout.write(`\n${model} — corpus indexed in ${(indexMs / 1000).toFixed(1)}s\n\n`);
  process.stdout.write("semantic/confident  mode     mrr    recall@5  top1   false-pos\n");
  for (const thresholds of sweep) {
    const report = await measure(
      dbPath,
      tempDir,
      tools,
      provider,
      corpus.anchors,
      corpus.negatives,
      thresholds,
    );
    for (const mode of MODES) {
      const row = report[mode];
      process.stdout.write(
        `${`${thresholds[0]} / ${thresholds[1]}`.padEnd(19)} ${mode.padEnd(8)} ` +
          `${String(row.mrr).padEnd(6)} ${String(row.recallAt5).padEnd(9)} ` +
          `${String(row.top1).padEnd(6)} ${row.falsePositiveRate}\n`,
      );
    }
    process.stdout.write("\n");
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
