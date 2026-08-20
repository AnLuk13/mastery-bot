import { z } from "zod";

/** One retrievable unit of a document: a heading section, or a slice of one if it's long. */
export interface Chunk {
  path: string;
  heading: string | null;
  text: string;
}

export interface IndexedChunk extends Chunk {
  vector: number[];
}

const indexedChunkSchema = z.object({
  path: z.string(),
  heading: z.string().nullable(),
  text: z.string(),
  vector: z.array(z.number()),
}) satisfies z.ZodType<IndexedChunk>;

export const embeddingsIndexSchema = z.object({
  model: z.string(),
  dimensions: z.number().int().positive(),
  chunks: z.array(indexedChunkSchema),
});

export type EmbeddingsIndex = z.infer<typeof embeddingsIndexSchema>;

export interface RetrievedChunk extends Chunk {
  score: number;
}
