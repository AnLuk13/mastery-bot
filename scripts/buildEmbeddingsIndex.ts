/**
 * Offline, one-off script: walks the local content root, chunks every document,
 * embeds each chunk with the same locally bundled MiniLM model the running bot
 * uses for queries, and writes the result to src/rag/data/embeddingsIndex.json —
 * which gets committed and deployed like any other source file.
 *
 * Deliberately NOT run inside the Vercel function: embedding an entire
 * knowledge base on every chat request would be slow and wasteful when the
 * corpus only changes when you edit your notes. Re-run this (`npm run
 * build:index`) and push whenever content changes.
 *
 * Run with: npm run build:index
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { LocalFilesystemContentProvider, type ContentEntry } from "@/content";
import { chunkDocument } from "@/rag/chunk";
import { embedText } from "@/rag/embeddingModel";
import type { EmbeddingsIndex, IndexedChunk } from "@/rag/types";

const OUTPUT_PATH = path.join(
  process.cwd(),
  "src/rag/data/embeddingsIndex.json",
);
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DIMENSIONS = 384;

async function collectDocumentPaths(
  provider: LocalFilesystemContentProvider,
  dirPath: string,
): Promise<string[]> {
  const entries: ContentEntry[] = await provider.listDirectory(dirPath);
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.type === "document") {
      paths.push(entry.path);
    } else {
      paths.push(...(await collectDocumentPaths(provider, entry.path)));
    }
  }
  return paths;
}

/** Trims float noise from the model's output; 5 decimals keeps ranking quality while cutting JSON size substantially. */
function roundVector(vector: readonly number[]): number[] {
  return vector.map((value) => Math.round(value * 1e5) / 1e5);
}

async function main(): Promise<void> {
  const contentRoot = process.env.CONTENT_ROOT;
  if (!contentRoot) {
    throw new Error(
      "CONTENT_ROOT is not set. Run via `npm run build:index`, which loads .env.local.",
    );
  }

  const provider = new LocalFilesystemContentProvider(contentRoot);
  const documentPaths = await collectDocumentPaths(provider, "");
  console.log(`Found ${documentPaths.length} documents under ${contentRoot}`);

  const chunks: IndexedChunk[] = [];
  for (const documentPath of documentPaths) {
    const document = await provider.getDocument(documentPath);
    const documentChunks = chunkDocument(document);
    for (const chunk of documentChunks) {
      const vector = await embedText(
        chunk.heading ? `${chunk.heading}\n${chunk.text}` : chunk.text,
      );
      chunks.push({ ...chunk, vector: roundVector(vector) });
    }
    console.log(
      `  embedded ${documentChunks.length} chunk(s) — ${documentPath}`,
    );
  }

  const index: EmbeddingsIndex = {
    model: MODEL_ID,
    dimensions: DIMENSIONS,
    chunks,
  };
  await writeFile(OUTPUT_PATH, JSON.stringify(index), "utf8");
  console.log(`Wrote ${chunks.length} chunks to ${OUTPUT_PATH}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
