import { isPathVisible, type PrivateFolderConfig } from "@/content";
import { GroqRateLimitedError, GroqUnavailableError } from "./errors";
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
  // The "ask" model (groq/compound-mini) has a much stricter daily request cap
  // than /save's model — shared across all users of this bot, since Groq rate
  // limits are per API key, not per caller. When it's exhausted or otherwise
  // unavailable, falling back to /save's higher-capacity model still answers
  // the question (from notes + general knowledge, without live web search)
  // instead of failing outright. Optional so tests/local dev without a second
  // model configured keep working exactly as before.
  fallbackGroq?: Pick<GroqClient, "createChatCompletion">;
}

export interface Answer {
  text: string;
  sources: string[];
  rateLimit: RateLimitInfo | undefined;
  /** True when the primary ask model was unavailable and this answer came from the fallback model instead — without live web search. */
  usedFallback: boolean;
  /** Why the fallback was used, or undefined when usedFallback is false. "rate-limited" is specifically the daily request cap; "unavailable" covers everything else the primary model can fail with (network error, malformed response, empty completion, a non-rate-limit error status). */
  fallbackReason: "rate-limited" | "unavailable" | undefined;
}

function buildSystemPrompt(hasWebSearch: boolean): string {
  const webSearchParagraph = hasWebSearch
    ? "\n\nYou have live web search available — use it whenever a question needs current information (news, prices, versions, anything that changes after your training) rather than guessing or refusing. When you do, keep the citation light (e.g. a source name inline), not a formal reference list."
    : "";

  return `You are the assistant built into "Mastery", a private Telegram bot that lets its user read their own personal Markdown study notes.

You will be given excerpts retrieved from those notes for the current question, each labeled with its file path. Ground your answer in those excerpts whenever they're actually relevant. If they aren't relevant to the question, ignore them and answer from your own knowledge instead, and don't imply the answer came from the notes. Never fabricate a file path or claim content exists in the notes that wasn't given to you.${webSearchParagraph}

Keep answers reasonably concise — this is a Telegram chat, not a document. Standard Markdown (bold, bullet lists, inline code) is rendered properly and fine to use; avoid heading syntax (#) and large code blocks unless the question specifically asks for code.`;
}

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

export interface ReferenceDocument {
  path: string;
  content: string;
}

export async function answerQuestion(
  question: string,
  userId: number | undefined,
  deps: AnswerQuestionDeps,
  priorTranscript = "",
  referenceDocument?: ReferenceDocument,
): Promise<Answer> {
  // A pronoun-heavy follow-up ("summarize that") carries little retrievable
  // meaning on its own — embedding it together with the prior turns gets
  // notes retrieval back on topic instead of searching on "that" alone.
  const queryVector = await deps.embed(
    priorTranscript ? `${priorTranscript}\n${question}` : question,
  );
  const retrieved = retrieveTopK(queryVector, deps.index, TOP_K).filter(
    (chunk) => isPathVisible(chunk.path, userId, deps.privateFolders),
  );

  // Distinct from the retrieved-notes context below: this is the document the
  // user was just browsing (their ambient "last viewed" session state, not a
  // relevance-scored search hit), so it's framed as something that may or may
  // not bear on the current question rather than as ground truth to cite.
  const documentBlock = referenceDocument
    ? `The user was just viewing this document (it may or may not be relevant to their question) — ${referenceDocument.path}:\n${referenceDocument.content}\n\n`
    : "";
  const conversationBlock = priorTranscript
    ? `Prior conversation in this thread:\n${priorTranscript}\n\n`
    : "";
  const userContent = `${documentBlock}${conversationBlock}Retrieved notes:\n\n${buildContextBlock(retrieved)}\n\nQuestion: ${question}`;

  let text: string;
  let rateLimit: RateLimitInfo | undefined;
  let usedFallback = false;
  let fallbackReason: "rate-limited" | "unavailable" | undefined;
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(true) },
      { role: "user", content: userContent },
    ];
    ({ text, rateLimit } = await deps.groq.createChatCompletion(messages));
  } catch (error) {
    if (
      !deps.fallbackGroq ||
      !(
        error instanceof GroqRateLimitedError ||
        error instanceof GroqUnavailableError
      )
    ) {
      throw error;
    }
    // The primary "ask" model is out of daily capacity (or otherwise down) —
    // still answer from notes + general knowledge rather than fail outright,
    // just without live web search this turn. If the fallback itself also
    // fails, that error propagates as-is (describeAskError still maps it to
    // a sensible message).
    const fallbackMessages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(false) },
      { role: "user", content: userContent },
    ];
    ({ text, rateLimit } = await deps.fallbackGroq.createChatCompletion(
      fallbackMessages,
      { reasoningEffort: "low" },
    ));
    usedFallback = true;
    fallbackReason =
      error instanceof GroqRateLimitedError ? "rate-limited" : "unavailable";
  }

  const sources = [
    ...new Set(
      retrieved
        .filter((chunk) => chunk.score >= CITATION_SCORE_THRESHOLD)
        .map((chunk) => chunk.path),
    ),
  ];

  return { text, sources, rateLimit, usedFallback, fallbackReason };
}
