import type { EmbeddingsIndex, IndexedChunk, RetrievedChunk } from "./types";

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Vectors are already L2-normalized at embed time (see embeddingModel.ts), so
  // dot product alone equals cosine similarity — no need to divide by magnitudes.
  return dot;
}

/**
 * Brute-force top-k similarity search over the whole index. Matches the same
 * tradeoff already made by GitHubContentProvider.search()/LocalFilesystemContentProvider.search():
 * a linear scan is simple and fast enough for a personal knowledge base of this
 * size, and would need real indexing infrastructure to scale further.
 */
export function retrieveTopK(
  queryVector: readonly number[],
  index: EmbeddingsIndex,
  k: number,
): RetrievedChunk[] {
  const scored = index.chunks.map((chunk: IndexedChunk) => ({
    path: chunk.path,
    heading: chunk.heading,
    text: chunk.text,
    score: cosineSimilarity(queryVector, chunk.vector),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
