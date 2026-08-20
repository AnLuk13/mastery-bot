import { normalizeRelativePath } from "@/content";

/**
 * Stateless navigation via Telegram callback_data: every button embeds the
 * validated canonical content path directly (no server-side session, no
 * in-memory Maps — any Vercel invocation can decode any button tap on its
 * own). Telegram limits callback_data to 64 bytes UTF-8, so paths that would
 * exceed that are routed to a dedicated "too long" callback instead of being
 * silently dropped or truncated into something unsafe.
 */

export const MAX_CALLBACK_DATA_BYTES = 64;

const DIRECTORY_PREFIX = "d:";
const DOCUMENT_PREFIX = "f:";
export const SEARCH_HELP_CALLBACK_DATA = "s";
export const TOO_LONG_CALLBACK_DATA = "x";

export type DecodedCallback =
  | { type: "directory"; path: string }
  | { type: "document"; path: string }
  | { type: "search-help" }
  | { type: "too-long" }
  | { type: "invalid" };

function byteLength(data: string): number {
  return Buffer.byteLength(data, "utf8");
}

export function isCallbackDataTooLarge(data: string): boolean {
  return byteLength(data) > MAX_CALLBACK_DATA_BYTES;
}

/** Builds directory/document callback_data, or the "too long" sentinel if it would exceed Telegram's limit. */
export function encodeNavigateCallbackData(
  kind: "directory" | "document",
  canonicalPath: string,
): string {
  const prefix = kind === "directory" ? DIRECTORY_PREFIX : DOCUMENT_PREFIX;
  const data = `${prefix}${canonicalPath}`;
  return isCallbackDataTooLarge(data) ? TOO_LONG_CALLBACK_DATA : data;
}

/** Never trusts callback_data: any unrecognized shape or unsafe path decodes to {type:"invalid"}. */
export function decodeCallbackData(data: string): DecodedCallback {
  if (data === SEARCH_HELP_CALLBACK_DATA) return { type: "search-help" };
  if (data === TOO_LONG_CALLBACK_DATA) return { type: "too-long" };

  if (data.startsWith(DIRECTORY_PREFIX)) {
    return decodePath("directory", data.slice(DIRECTORY_PREFIX.length));
  }
  if (data.startsWith(DOCUMENT_PREFIX)) {
    return decodePath("document", data.slice(DOCUMENT_PREFIX.length));
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
