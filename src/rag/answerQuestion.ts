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
// Unlike the retrieved-notes context (bounded by TOP_K * chunking's own size
// cap) or the transcript (ASK_CONTEXT_BUDGET in userMessages.ts), the
// reference document is whatever the user happened to be browsing — no
// inherent size limit. Confirmed live: an uncapped large document pushed the
// request past Groq's payload limit for the compound models specifically
// (413), silently burning through both web-search fallback tiers before the
// structured model's more permissive limit finally let it through.
const MAX_REFERENCE_DOCUMENT_CHARS = 2000;

export interface AnswerQuestionDeps {
  embed(text: string): Promise<number[]>;
  index: EmbeddingsIndex;
  // Pick<>, not the concrete class: GroqClient's private fields would otherwise
  // make it nominally typed, forcing every test fake to be a real instance.
  groq: Pick<GroqClient, "createChatCompletion">;
  privateFolders: readonly PrivateFolderConfig[];
  // Groq tracks each model's daily request cap independently, not pooled
  // across models under one API key (verified live: exhausting groq/compound-
  // mini's 250/day doesn't move groq/compound's remaining-requests counter).
  // So a second compound model is a genuinely separate 250/day budget, tried
  // before giving up web search entirely. Optional so tests/local dev without
  // a second model configured keep working exactly as before.
  webSearchFallbackGroq?: Pick<GroqClient, "createChatCompletion">;
  // Only reached once BOTH compound models are exhausted or down. Answers from
  // notes + general knowledge, without live web search, rather than failing
  // outright. Optional so tests/local dev without a fallback configured keep
  // working exactly as before.
  fallbackGroq?: Pick<GroqClient, "createChatCompletion">;
}

export interface Answer {
  text: string;
  sources: string[];
  rateLimit: RateLimitInfo | undefined;
  /** True when the primary ask model wasn't the one that answered — either fallback tier was used. */
  usedFallback: boolean;
  /** Why the primary model wasn't used, or undefined when usedFallback is false. "rate-limited" is specifically the daily request cap; "unavailable" covers everything else a Groq call can fail with (network error, malformed response, empty completion, a non-rate-limit error status). */
  fallbackReason: "rate-limited" | "unavailable" | undefined;
  /** False only when the answer came from the final non-search fallback — the two compound models both have live web search, so falling back between them doesn't lose it. */
  hasWebSearch: boolean;
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
  const truncatedReferenceContent =
    referenceDocument &&
    referenceDocument.content.length > MAX_REFERENCE_DOCUMENT_CHARS
      ? `${referenceDocument.content.slice(0, MAX_REFERENCE_DOCUMENT_CHARS)}…`
      : referenceDocument?.content;
  const documentBlock = referenceDocument
    ? `The user was just viewing this document (it may or may not be relevant to their question) — ${referenceDocument.path}:\n${truncatedReferenceContent}\n\n`
    : "";
  const conversationBlock = priorTranscript
    ? `Prior conversation in this thread:\n${priorTranscript}\n\n`
    : "";
  const userContent = `${documentBlock}${conversationBlock}Retrieved notes:\n\n${buildContextBlock(retrieved)}\n\nQuestion: ${question}`;

  const webSearchMessages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(true) },
    { role: "user", content: userContent },
  ];
  const noSearchMessages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(false) },
    { role: "user", content: userContent },
  ];

  // Tried in order until one succeeds: primary compound model, then the
  // second compound model (still has web search, a genuinely separate daily
  // quota — see AnswerQuestionDeps), then the structured model as a final,
  // non-search fallback. Each tier is skipped if its deps weren't configured.
  const attempts: {
    groq: Pick<GroqClient, "createChatCompletion">;
    messages: ChatMessage[];
    options?: Parameters<GroqClient["createChatCompletion"]>[1];
    hasWebSearch: boolean;
  }[] = [{ groq: deps.groq, messages: webSearchMessages, hasWebSearch: true }];
  if (deps.webSearchFallbackGroq) {
    attempts.push({
      groq: deps.webSearchFallbackGroq,
      messages: webSearchMessages,
      hasWebSearch: true,
    });
  }
  if (deps.fallbackGroq) {
    attempts.push({
      groq: deps.fallbackGroq,
      messages: noSearchMessages,
      options: { reasoningEffort: "low" },
      hasWebSearch: false,
    });
  }

  let text: string | undefined;
  let rateLimit: RateLimitInfo | undefined;
  let hasWebSearch = true;
  let fallbackReason: "rate-limited" | "unavailable" | undefined;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      ({ text, rateLimit } = await attempt.groq.createChatCompletion(
        attempt.messages,
        attempt.options,
      ));
      hasWebSearch = attempt.hasWebSearch;
      break;
    } catch (error) {
      // The user-facing error/notice never names the underlying cause (by
      // design — describeAskError and formatFallbackNotice both stay
      // generic), which otherwise leaves zero trail for "why did this
      // fall back" beyond "it did." Logged here so a real Groq-side issue
      // is diagnosable from Vercel logs instead of unrecoverable after the
      // fact.
      console.error(`Ask tier ${i} failed:`, error);
      const isLastAttempt = i === attempts.length - 1;
      const isRetryable =
        error instanceof GroqRateLimitedError ||
        error instanceof GroqUnavailableError;
      if (isLastAttempt || !isRetryable) throw error;
      if (i === 0) {
        fallbackReason =
          error instanceof GroqRateLimitedError
            ? "rate-limited"
            : "unavailable";
      }
      // Otherwise: this tier failed but wasn't the last one — move on to the
      // next attempt in the loop.
    }
  }
  // Unreachable: the loop above always either assigns `text` and breaks, or
  // throws before falling out — attempts always has at least one entry.
  if (text === undefined) throw new GroqUnavailableError();

  const usedFallback = fallbackReason !== undefined;

  const sources = [
    ...new Set(
      retrieved
        .filter((chunk) => chunk.score >= CITATION_SCORE_THRESHOLD)
        .map((chunk) => chunk.path),
    ),
  ];

  return {
    text,
    sources,
    rateLimit,
    usedFallback,
    fallbackReason,
    hasWebSearch,
  };
}
