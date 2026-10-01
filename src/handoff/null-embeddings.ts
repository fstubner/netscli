import type { EmbeddingProvider, SemanticOffReason } from "./embeddings.js";

/** What to tell a caller that asked for vectors while semantic search is off. */
export function semanticOffMessage(reason: SemanticOffReason): string {
  return reason === "not_enabled"
    ? "semantic search is not enabled: run `xtctx embeddings enable`"
    : "embeddings are disabled (XTCTX_DISABLE_EMBEDDINGS)";
}

/**
 * The embedding provider for a project where semantic search is off, which is
 * the default: the local model is an add-on (`xtctx embeddings enable`), so a
 * fresh install has none to load.
 *
 * Every search already degrades to keyword when semantic embeddings are
 * unavailable — that path is real, and reported. This makes it explicit and
 * free, for callers that want the index without the model behind it. The index
 * reads `semanticOff` and never calls `embed*`: hybrid search answers from
 * keyword directly, nothing is counted as an outstanding backlog, and vectors
 * an earlier install already built are kept rather than dropped as belonging
 * to some other model.
 *
 * `XTCTX_DISABLE_EMBEDDINGS=1` selects it too, which is what the test suite
 * uses. Vitest fans out across workers, and a provider constructed by default
 * meant several of them initialising a ~100MB ONNX model at once; that
 * exhausted memory, ONNX raised `bad allocation`, and the worker died
 * mid-file. The visible symptom was not an embedding failure but an unrelated
 * test failing, a different one each run.
 *
 * `isReady` is true so nothing waits for a load that will never happen, and
 * `embedBatch` refuses rather than returning zero vectors, which would be
 * indistinguishable from a real embedding of empty text and would quietly
 * poison a similarity ranking.
 */
export class NullEmbeddingProvider implements EmbeddingProvider {
  readonly model = "null";

  constructor(readonly semanticOff: SemanticOffReason = "disabled_by_env") {}

  private refusal(): Error {
    return new Error(semanticOffMessage(this.semanticOff));
  }

  async embed(_text: string): Promise<Float32Array> {
    throw this.refusal();
  }

  async embedBatch(_texts: string[]): Promise<Float32Array[]> {
    throw this.refusal();
  }

  isReady(): boolean {
    return true;
  }

  warm(): void {
    // Nothing to warm.
  }
}
