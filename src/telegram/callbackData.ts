import { normalizeRelativePath } from "@/content";
import type { RateLimitInfo } from "@/rag/groqClient";

/**
 * Stateless navigation via Telegram callback_data: every button embeds the
 * validated canonical content path directly (no server-side session, no
 * in-memory Maps — any Vercel invocation can decode any button tap on its
 * own). Telegram limits callback_data to 64 bytes UTF-8, so paths that would
 * exceed that are routed to a dedicated "too long" callback instead of being
 * silently dropped or truncated into something unsafe.
 *
 * A directory callback can optionally carry a "cleanup" hint: when opening a
 * document that didn't fit in one Telegram message, the extra messages sent
 * for the overflow are a fixed run of consecutive message IDs starting right
 * after the message being edited (true for a private chat with a single bot
 * sending them in a tight sequential loop, per Telegram's per-chat message
 * ID allocation). Encoding {firstMessageId, count} on Back/Home lets a later,
 * unrelated invocation delete that entire run before showing the menu again
 * — still no server-side state, just more information riding in the same
 * callback_data. `%` is the delimiter because normalizeRelativePath rejects
 * it in any path outright, so it can never collide with real content.
 */

export const MAX_CALLBACK_DATA_BYTES = 64;

const DIRECTORY_PREFIX = "d:";
const DOCUMENT_PREFIX = "f:";
const LIMITS_PREFIX = "l:";
const CLEANUP_SEPARATOR = "%";
const CLEANUP_PATTERN = /^(\d+)\+(\d+)$/;
const LIMITS_PATTERN = /^(\d+)-(\d+)-(\d+)-(\d+)$/;
export const SEARCH_HELP_CALLBACK_DATA = "s";
export const TOO_LONG_CALLBACK_DATA = "x";

export interface CleanupHint {
  /** message_id of the first extra message to delete (a consecutive run of `count` messages). */
  firstMessageId: number;
  count: number;
}

export type DecodedCallback =
  | { type: "directory"; path: string; cleanup?: CleanupHint }
  | { type: "document"; path: string }
  | { type: "search-help" }
  | { type: "limits"; rateLimit: RateLimitInfo }
  | { type: "too-long" }
  | { type: "invalid" };

function byteLength(data: string): number {
  return Buffer.byteLength(data, "utf8");
}

export function isCallbackDataTooLarge(data: string): boolean {
  return byteLength(data) > MAX_CALLBACK_DATA_BYTES;
}

/**
 * Builds directory/document callback_data, or the "too long" sentinel if it
 * would exceed Telegram's limit. A `cleanup` hint is only ever meaningful for
 * "directory" (Back/Home always navigate to a directory) and is dropped
 * automatically — navigation still works, it just won't clean up stale
 * messages — if adding it would push the data over budget.
 */
export function encodeNavigateCallbackData(
  kind: "directory" | "document",
  canonicalPath: string,
  cleanup?: CleanupHint,
): string {
  const prefix = kind === "directory" ? DIRECTORY_PREFIX : DOCUMENT_PREFIX;
  const base = `${prefix}${canonicalPath}`;

  if (cleanup && cleanup.count > 0) {
    const withCleanup = `${base}${CLEANUP_SEPARATOR}${cleanup.firstMessageId}+${cleanup.count}`;
    if (!isCallbackDataTooLarge(withCleanup)) return withCleanup;
  }

  return isCallbackDataTooLarge(base) ? TOO_LONG_CALLBACK_DATA : base;
}

/**
 * Encodes a snapshot of Groq's rate-limit headers (see groqClient.ts) directly
 * into the button, the same "no server state" approach as navigation: whichever
 * invocation handles the tap just formats the numbers it decodes, nothing is
 * looked up. Returns undefined (button should be omitted) in the practically
 * impossible case the numbers don't fit Telegram's budget.
 */
export function encodeLimitsCallbackData(
  rateLimit: RateLimitInfo,
): string | undefined {
  const data = `${LIMITS_PREFIX}${rateLimit.remainingRequests}-${rateLimit.limitRequests}-${rateLimit.remainingTokens}-${rateLimit.limitTokens}`;
  return isCallbackDataTooLarge(data) ? undefined : data;
}

/** Never trusts callback_data: any unrecognized shape or unsafe path decodes to {type:"invalid"}. */
export function decodeCallbackData(data: string): DecodedCallback {
  if (data === SEARCH_HELP_CALLBACK_DATA) return { type: "search-help" };
  if (data === TOO_LONG_CALLBACK_DATA) return { type: "too-long" };

  if (data.startsWith(DOCUMENT_PREFIX)) {
    return decodePath("document", data.slice(DOCUMENT_PREFIX.length));
  }

  if (data.startsWith(LIMITS_PREFIX)) {
    const rateLimit = parseRateLimit(data.slice(LIMITS_PREFIX.length));
    return rateLimit ? { type: "limits", rateLimit } : { type: "invalid" };
  }

  if (data.startsWith(DIRECTORY_PREFIX)) {
    const rest = data.slice(DIRECTORY_PREFIX.length);

    // Only ever split on "%" if what follows it actually parses as a cleanup
    // hint. A real path can never contain "%" (normalizeRelativePath rejects
    // it outright), so anything else — including an attempt like "%2e%2e" —
    // must fall through to validating `rest` whole, which correctly rejects it,
    // rather than risk truncating malicious input into a valid-looking path.
    const separatorIndex = rest.lastIndexOf(CLEANUP_SEPARATOR);
    if (separatorIndex !== -1) {
      const cleanup = parseCleanupHint(rest.slice(separatorIndex + 1));
      if (cleanup) {
        const decoded = decodePath("directory", rest.slice(0, separatorIndex));
        return decoded.type === "directory" ? { ...decoded, cleanup } : decoded;
      }
    }

    return decodePath("directory", rest);
  }

  return { type: "invalid" };
}

function decodePath(
  type: "directory" | "document",
  rawPath: string,
): DecodedCallback {
  try {
    return { type, path: normalizeRelativePath(rawPath) };
  } catch {
    return { type: "invalid" };
  }
}

function parseRateLimit(raw: string): RateLimitInfo | undefined {
  const match = LIMITS_PATTERN.exec(raw);
  if (!match) return undefined;

  const [remainingRequests, limitRequests, remainingTokens, limitTokens] = match
    .slice(1)
    .map(Number);
  if (
    ![remainingRequests, limitRequests, remainingTokens, limitTokens].every(
      Number.isSafeInteger,
    )
  ) {
    return undefined;
  }
  return { remainingRequests, limitRequests, remainingTokens, limitTokens };
}

function parseCleanupHint(raw: string): CleanupHint | undefined {
  const match = CLEANUP_PATTERN.exec(raw);
  if (!match) return undefined;

  const firstMessageId = Number(match[1]);
  const count = Number(match[2]);
  if (
    !Number.isSafeInteger(firstMessageId) ||
    !Number.isSafeInteger(count) ||
    count <= 0
  ) {
    return undefined;
  }
  return { firstMessageId, count };
}
