import { isPathVisible, type PrivateFolderConfig } from "@/content";
import type { EmbeddingsIndex } from "./types";
import type { ChatMessage, GroqClient, RateLimitInfo } from "./groqClient";
import { retrieveTopK } from "./retrieve";

const TOP_K = 5;
// Cosine similarity below this is treated as "not actually relevant" for citing a
// source, even though the chunk still gets passed to the model as loose context.
// Calibrated against real questions: unrelated topics scored ~0.1-0.2, genuinely
// in-corpus topics scored 0.55+, and a borderline case (a React question, which
// shares vocabulary with the AI/app-building chapters without being about them)
// scored 0.37 — high enough to false-positive at the old 0.35 threshold.
const CITATION_SCORE_THRESHOLD = 0.45;

export interface AnswerQuestionDeps {
  embed(text: string): Promise<number[]>;
  index: EmbeddingsIndex;
  // Pick<>, not the concrete class: GroqClient's private fields would otherwise
  // make it nominally typed, forcing every test fake to be a real instance.
  groq: Pick<GroqClient, "createChatCompletion">;
  privateFolders: readonly PrivateFolderConfig[];
}

export interface Answer {
  text: string;
  sources: string[];
  rateLimit: RateLimitInfo | undefined;
}

const SYSTEM_PROMPT = `You are the assistant built into "Mastery", a private Telegram bot that lets its one user read their own personal Markdown study notes (currently covering .NET, networking, and AI/ML).

You will be given excerpts retrieved from those notes for the current question, each labeled with its file path. Ground your answer in those excerpts whenever they're actually relevant. If they aren't relevant to the question, ignore them and answer from your own knowledge instead, and don't imply the answer came from the notes. Never fabricate a file path or claim content exists in the notes that wasn't given to you.

Keep answers reasonably concise — this is a Telegram chat, not a document. Standard Markdown (bold, bullet lists, inline code) is rendered properly and fine to use; avoid heading syntax (#) and large code blocks unless the question specifically asks for code.`;

function buildContextBlock(
  chunks: readonly { path: string; heading: string | null; text: string }[],
): string {
  if (chunks.length === 0) return "(no notes were retrieved for this question)";
  return chunks
    .map((chunk) => {
      const label = chunk.heading
        ? `${chunk.path} — ${chunk.heading}`
        : chunk.path;
      return `[${label}]\n${chunk.text}`;
    })
    .join("\n\n---\n\n");
}

export async function answerQuestion(
  question: string,
  userId: number | undefined,
  deps: AnswerQuestionDeps,
): Promise<Answer> {
  const queryVector = await deps.embed(question);
  const retrieved = retrieveTopK(queryVector, deps.index, TOP_K).filter(
    (chunk) => isPathVisible(chunk.path, userId, deps.privateFolders),
  );

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Retrieved notes:\n\n${buildContextBlock(retrieved)}\n\nQuestion: ${question}`,
    },
  ];

  const { text, rateLimit } = await deps.groq.createChatCompletion(messages);

  const sources = [
    ...new Set(
      retrieved
        .filter((chunk) => chunk.score >= CITATION_SCORE_THRESHOLD)
        .map((chunk) => chunk.path),
    ),
  ];

  return { text, sources, rateLimit };
}
