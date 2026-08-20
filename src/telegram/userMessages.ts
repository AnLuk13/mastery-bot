import {
  ContentNotFoundError,
  ContentProviderAuthError,
  ContentProviderPermissionError,
  ContentProviderRateLimitedError,
  ContentProviderUnavailableError,
  InvalidPathError,
} from "@/content";

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
