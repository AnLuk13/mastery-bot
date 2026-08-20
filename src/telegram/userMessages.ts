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

/** Maps any error answerQuestion() can throw to a safe, generic message. Never echoes the raw error. */
export function describeAskError(error: unknown): string {
  if (error instanceof GroqRateLimitedError) {
    return "⚠️ Too many questions at once — please try again in a moment.";
  }
  if (error instanceof GroqUnavailableError) {
    return "⚠️ Couldn't get an answer right now. Please try again shortly.";
  }
  return "⚠️ Something went wrong answering that. Please try again.";
}

/** Formats a snapshot of Groq's rate limits (as of the answer that carried this button) for a toast alert. */
export function formatRateLimitMessage(rateLimit: RateLimitInfo): string {
  return (
    `📊 Groq usage (as of that answer)\n` +
    `Requests: ${rateLimit.remainingRequests}/${rateLimit.limitRequests} left\n` +
    `Tokens: ${rateLimit.remainingTokens}/${rateLimit.limitTokens} left`
  );
}

export const SAVE_USAGE_MESSAGE =
  "💾 Usage: /save <note text>, or upload a .txt/.md file.";
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

export function formatSaveSuccess(path: string, content: string): string {
  const preview = content.length > 300 ? `${content.slice(0, 300)}…` : content;
  return `✅ Saved to ${path}\n\n${preview}`;
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
