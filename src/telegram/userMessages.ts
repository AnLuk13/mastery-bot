import { z } from "zod";
import {
  ContentNotFoundError,
  ContentProviderAuthError,
  ContentProviderPermissionError,
  ContentProviderRateLimitedError,
  ContentProviderUnavailableError,
  ContentWriteConflictError,
  InvalidPathError,
} from "@/content";
import { GroqRateLimitedError, GroqUnavailableError } from "@/rag/errors";
import type { RateLimitInfo } from "@/rag/groqClient";

export const ACCESS_DENIED_MESSAGE = "🔒 This is a private bot.";
export const INVALID_NAVIGATION_MESSAGE = "⚠️ Invalid navigation.";
export const TOO_LONG_MESSAGE =
  "⚠️ That item's path is too long to open right now.";
export const SEARCH_USAGE_MESSAGE = "🔎 Usage: /search <query>";

export function formatSearchTitle(query: string): string {
  return `🔎 Search: ${query}`;
}

export function formatNoSearchResults(query: string): string {
  return `${formatSearchTitle(query)}\n\nNo results found.`;
}

/** Maps any error a ContentProvider can throw to a safe, generic message. Never echoes the raw error. */
export function describeContentError(error: unknown): string {
  if (error instanceof ContentNotFoundError) {
    return "📄 Not found.";
  }
  if (error instanceof InvalidPathError) {
    return INVALID_NAVIGATION_MESSAGE;
  }
  if (
    error instanceof ContentProviderAuthError ||
    error instanceof ContentProviderPermissionError ||
    error instanceof ContentProviderRateLimitedError ||
    error instanceof ContentProviderUnavailableError
  ) {
    return "⚠️ Couldn't load content right now. Please try again shortly.";
  }
  return "⚠️ Something went wrong. Please try again.";
}

export const UNKNOWN_COMMAND_MESSAGE = "❓ Unknown command.";

function formatRetryWait(retryAfterSeconds: number | undefined): string {
  if (retryAfterSeconds === undefined) return " Please try again shortly.";
  if (retryAfterSeconds < 60) {
    return ` Please try again in about ${retryAfterSeconds}s.`;
  }
  const minutes = Math.round(retryAfterSeconds / 60);
  if (minutes < 60) return ` Please try again in about ${minutes}m.`;
  const hours = Math.round(minutes / 60);
  return ` Please try again in about ${hours}h.`;
}

/** Maps any error answerQuestion() can throw to a safe, generic message. Never echoes the raw error. */
export function describeAskError(error: unknown): string {
  if (error instanceof GroqRateLimitedError) {
    // Reaching this means even the fallback model (see answerQuestion.ts)
    // couldn't cover it either — worth being specific that this is a
    // shared, bot-wide Groq limit, not something the asker did wrong, since
    // it can otherwise look like a bug that "every question" suddenly fails.
    return `⚠️ Groq's request limit has been reached (a limit shared across everyone using this bot, not a per-person one) and the backup model is out too.${formatRetryWait(error.retryAfterSeconds)}`;
  }
  if (error instanceof GroqUnavailableError) {
    return "⚠️ Couldn't get an answer right now. Please try again shortly.";
  }
  return "⚠️ Something went wrong answering that. Please try again.";
}

/** Appended to an /ask answer that came from the fallback model — visible so a missing-web-search answer doesn't look like the model just declined to search. */
export function formatFallbackNotice(): string {
  return "\n\n⚠️ Answered without live web search — today's request limit for that was reached.";
}

/** Formats a snapshot of Groq's rate limits (as of the answer that carried this button) for a toast alert. */
export function formatRateLimitMessage(rateLimit: RateLimitInfo): string {
  return (
    `📊 Groq usage (as of that answer)\n` +
    `Requests: ${rateLimit.remainingRequests}/${rateLimit.limitRequests} left\n` +
    `Tokens: ${rateLimit.remainingTokens}/${rateLimit.limitTokens} left`
  );
}

const ASK_TURN_SEPARATOR = "\n\n===\n\n";
// Chars of transcript kept; oldest whole turns are dropped first, never
// truncated mid-turn, so what survives always reads as complete exchanges.
const ASK_CONTEXT_BUDGET = 1200;
// Each stored answer is capped independently too — a single long answer (a
// news roundup, a long explanation) would otherwise dominate the whole
// budget on its own.
const MAX_STORED_ANSWER_LENGTH = 350;

/** Caps a single piece of text before it goes into the session transcript — keeps one long answer from dominating the whole budget on its own. */
export function truncateForAskContext(text: string): string {
  return text.length > MAX_STORED_ANSWER_LENGTH
    ? `${text.slice(0, MAX_STORED_ANSWER_LENGTH)}…`
    : text;
}

/**
 * Appends a new turn to the ambient session transcript (see src/session),
 * dropping the oldest whole turns first once the budget is exceeded — never
 * truncating mid-turn, so what survives always reads as complete exchanges.
 */
export function appendAskTurn(
  transcript: string,
  question: string,
  answer: string,
): string {
  const turn = `Q: ${question}\nA: ${truncateForAskContext(answer)}`;
  const turns =
    transcript === ""
      ? [turn]
      : [...transcript.split(ASK_TURN_SEPARATOR), turn];
  while (
    turns.length > 1 &&
    turns.join(ASK_TURN_SEPARATOR).length > ASK_CONTEXT_BUDGET
  ) {
    turns.shift();
  }
  return turns.join(ASK_TURN_SEPARATOR);
}

export const SAVE_USAGE_MESSAGE =
  "💾 Usage: /save <note text>, upload a .txt/.md file, or reply to any message with /save to save its content.";
export const UNSUPPORTED_SAVE_FILE_MESSAGE =
  "⚠️ Only .txt and .md file uploads are supported.";

const SAVE_CONTEXT_MARKER = "⎯⎯⎯ save-context (do not edit) ⎯⎯⎯";
// Leaves headroom under Telegram's 4096-char limit for the question text itself.
const CLARIFY_CONTEXT_BUDGET = 3000;

/** The clarifying-question message: readable questions, plus the original request/content riding along in a reply-thread-recoverable marker block. */
export function formatClarifyPrompt(
  questions: readonly string[],
  contextToEcho: string,
): string {
  const truncated =
    contextToEcho.length > CLARIFY_CONTEXT_BUDGET
      ? `${contextToEcho.slice(0, CLARIFY_CONTEXT_BUDGET)}…`
      : contextToEcho;
  const questionLines = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `❓ Need a bit more info to save this:\n${questionLines}\n\nReply to THIS message with your answer.\n\n${SAVE_CONTEXT_MARKER}\n${truncated}`;
}

/** True when `replyToMessageText` is a reply to one of our own clarify prompts. */
export function isClarifyContinuation(
  replyToMessageText: string | undefined,
): boolean {
  return (
    replyToMessageText !== undefined &&
    replyToMessageText.includes(SAVE_CONTEXT_MARKER)
  );
}

/** Recovers the original request/content echoed into a clarify prompt, from the reply-to text. */
export function extractClarifyContext(replyToMessageText: string): string {
  const index = replyToMessageText.indexOf(SAVE_CONTEXT_MARKER);
  return index === -1
    ? ""
    : replyToMessageText.slice(index + SAVE_CONTEXT_MARKER.length).trim();
}

const REORGANIZE_MARKER = "⎯⎯⎯ reorganize-proposal (do not edit) ⎯⎯⎯";

const reorganizeProposalSchema = z.object({
  moveFrom: z.string().min(1),
  moveTo: z.string().min(1),
  newPath: z.string().min(1),
  content: z.string().min(1),
  commitMessage: z.string().min(1),
});

export type ReorganizeProposal = z.infer<typeof reorganizeProposalSchema>;

/**
 * The ask-first confirmation prompt for a proposed reorganize: readable text
 * plus the full proposal riding along in a marker block, the same
 * no-server-state trick as the clarify flow — except recovered from the
 * confirm/decline BUTTON's own message text (BotContext.callbackMessageText)
 * rather than a reply, since confirming is a tap, not a reply.
 */
export function formatReorganizePrompt(proposal: ReorganizeProposal): string {
  const topicFolder = proposal.moveTo.slice(
    0,
    proposal.moveTo.lastIndexOf("/"),
  );
  return `📁 This looks related to your existing ${proposal.moveFrom} — want me to group them under ${topicFolder}/?\n\n${REORGANIZE_MARKER}\n${JSON.stringify(proposal)}`;
}

/** True when `callbackMessageText` is one of our own reorganize proposals. */
export function isReorganizeProposal(
  callbackMessageText: string | undefined,
): boolean {
  return (
    callbackMessageText !== undefined &&
    callbackMessageText.includes(REORGANIZE_MARKER)
  );
}

/** Recovers the pending proposal from the confirm/decline message's own text. Returns undefined if missing or malformed — e.g. the message predates this feature. */
export function extractReorganizeProposal(
  callbackMessageText: string,
): ReorganizeProposal | undefined {
  const index = callbackMessageText.indexOf(REORGANIZE_MARKER);
  if (index === -1) return undefined;
  const raw = callbackMessageText
    .slice(index + REORGANIZE_MARKER.length)
    .trim();
  try {
    return reorganizeProposalSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function formatSaveSuccess(path: string, content: string): string {
  const preview = content.length > 300 ? `${content.slice(0, 300)}…` : content;
  return `✅ Saved to ${path}\n\n${preview}`;
}

export function formatReorganizeSuccess(proposal: ReorganizeProposal): string {
  const preview =
    proposal.content.length > 300
      ? `${proposal.content.slice(0, 300)}…`
      : proposal.content;
  return `✅ Saved to ${proposal.newPath}, and moved ${proposal.moveFrom} to ${proposal.moveTo}.\n\n${preview}`;
}

export function formatRevertSuccess(path: string): string {
  return `↩️ Reverted ${path}.`;
}

/** Maps any error the /save flow can throw to a safe, generic message. Never echoes the raw error. */
export function describeSaveError(error: unknown): string {
  if (error instanceof GroqRateLimitedError) {
    return "⚠️ Too many requests at once — please try again in a moment.";
  }
  if (error instanceof GroqUnavailableError) {
    return "⚠️ Couldn't process that save right now. Please try again shortly.";
  }
  if (error instanceof ContentWriteConflictError) {
    return "⚠️ That file changed since it was last read — please try again.";
  }
  if (
    error instanceof ContentProviderAuthError ||
    error instanceof ContentProviderPermissionError ||
    error instanceof ContentProviderRateLimitedError ||
    error instanceof ContentProviderUnavailableError
  ) {
    return "⚠️ Couldn't reach GitHub right now. Please try again shortly.";
  }
  return "⚠️ Something went wrong saving that. Please try again.";
}
