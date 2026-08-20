import path from "node:path";
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/**
 * Model files are committed under public/models/ (see scripts/buildEmbeddingsIndex.ts)
 * instead of fetched from the Hugging Face Hub at runtime: a Vercel function has no
 * durable cache between cold starts, so leaving allowRemoteModels on would mean
 * re-downloading ~23MB on every cold start, plus a hard runtime dependency on
 * huggingface.co being reachable. Bundling makes embedding fully offline and
 * deterministic, consistent with Vercel functions otherwise never depending on
 * anything but their own deployed code and the GitHub content API.
 */
env.allowRemoteModels = false;
env.localModelPath = path.join(process.cwd(), "public", "models");

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline("feature-extraction", MODEL_ID, {
    dtype: "q8",
    device: "cpu",
  });
  return extractorPromise;
}

/** Embeds `text` into a 384-dim, L2-normalized vector using a locally bundled MiniLM model. */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
