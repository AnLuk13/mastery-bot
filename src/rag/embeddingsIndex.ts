import raw from "./data/embeddingsIndex.json";
import { embeddingsIndexSchema, type EmbeddingsIndex } from "./types";

let cached: EmbeddingsIndex | undefined;

/**
 * Lazily validates the committed, precomputed embeddings index (see
 * scripts/buildEmbeddingsIndex.ts) on first use per warm instance, the same
 * caching shape as getEnv() in src/lib/env.ts.
 */
export function getEmbeddingsIndex(): EmbeddingsIndex {
  cached ??= embeddingsIndexSchema.parse(raw);
  return cached;
}
