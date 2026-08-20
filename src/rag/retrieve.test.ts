import { describe, expect, it } from "vitest";
import type { EmbeddingsIndex } from "./types";
import { retrieveTopK } from "./retrieve";

function index(chunks: EmbeddingsIndex["chunks"]): EmbeddingsIndex {
  return { model: "test", dimensions: 2, chunks };
}

describe("retrieveTopK", () => {
  it("ranks by cosine similarity, most similar first", () => {
    const idx = index([
      { path: "a.md", heading: null, text: "a", vector: [1, 0] },
      { path: "b.md", heading: null, text: "b", vector: [0, 1] },
      { path: "c.md", heading: null, text: "c", vector: [0.9, 0.1] },
    ]);

    const results = retrieveTopK([1, 0], idx, 3);
    expect(results.map((r) => r.path)).toEqual(["a.md", "c.md", "b.md"]);
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[2].score).toBeCloseTo(0, 5);
  });

  it("truncates to k results", () => {
    const idx = index([
      { path: "a.md", heading: null, text: "a", vector: [1, 0] },
      { path: "b.md", heading: null, text: "b", vector: [0.5, 0.5] },
      { path: "c.md", heading: null, text: "c", vector: [0, 1] },
    ]);

    expect(retrieveTopK([1, 0], idx, 2)).toHaveLength(2);
  });

  it("returns an empty array for an empty index", () => {
    expect(retrieveTopK([1, 0], index([]), 5)).toEqual([]);
  });
});
