/**
 * Splits an already-rendered, well-formed Telegram-HTML string into chunks
 * that each fit within maxLength, without ever cutting inside a tag or an
 * HTML entity, and without ever leaving a chunk with unbalanced tags: any
 * tags still open at a cut point are closed at the end of that chunk and
 * reopened at the start of the next one. Used only as a fallback for a
 * single block (paragraph/list/blockquote) that alone exceeds the Telegram
 * message-length limit — the normal case (most blocks) never reaches this.
 */

type Token =
  | { kind: "open" | "close"; raw: string; name: string }
  | { kind: "text"; raw: string };

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s+[^<>]*)?>/g;
const ENTITY_OR_CHAR_RE = /&[a-zA-Z]+;|[\s\S]/g;

function tokenizeHtml(html: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;

  for (const match of html.matchAll(TAG_RE)) {
    const [raw, name] = match;
    const index = match.index;
    if (index > lastIndex) {
      tokens.push({ kind: "text", raw: html.slice(lastIndex, index) });
    }
    tokens.push({ kind: raw.startsWith("</") ? "close" : "open", raw, name });
    lastIndex = index + raw.length;
  }
  if (lastIndex < html.length) {
    tokens.push({ kind: "text", raw: html.slice(lastIndex) });
  }
  return tokens;
}

function firstUnit(text: string): string {
  ENTITY_OR_CHAR_RE.lastIndex = 0;
  return ENTITY_OR_CHAR_RE.exec(text)?.[0] ?? "";
}

/** Greedily takes whole entities/characters from `text` up to maxLen; never splits inside a `&...;` entity. */
function takeUpTo(
  text: string,
  maxLen: number,
): { piece: string; rest: string } {
  const units = text.match(ENTITY_OR_CHAR_RE) ?? [];
  let piece = "";
  let index = 0;
  for (; index < units.length; index++) {
    if (piece.length + units[index].length > maxLen) break;
    piece += units[index];
  }
  return { piece, rest: units.slice(index).join("") };
}

export function splitHtmlSafely(html: string, maxLength: number): string[] {
  const tokens = tokenizeHtml(html);
  const chunks: string[] = [];
  let current = "";
  const openStack: { name: string; raw: string }[] = [];

  const closingOverhead = () =>
    openStack.reduce((sum, t) => sum + `</${t.name}>`.length, 0);
  const reopenPrefix = () => openStack.map((t) => t.raw).join("");

  const flush = () => {
    current += openStack
      .map((t) => `</${t.name}>`)
      .reverse()
      .join("");
    chunks.push(current);
    current = reopenPrefix();
  };

  for (const token of tokens) {
    if (token.kind === "open") {
      current += token.raw;
      openStack.push({ name: token.name, raw: token.raw });
      continue;
    }
    if (token.kind === "close") {
      current += token.raw;
      if (
        openStack.length > 0 &&
        openStack[openStack.length - 1].name === token.name
      ) {
        openStack.pop();
      }
      continue;
    }

    let remaining = token.raw;
    while (remaining.length > 0) {
      const budget = maxLength - closingOverhead();
      const available = budget - current.length;
      const atFreshChunk = current === reopenPrefix();

      if (available <= 0) {
        if (atFreshChunk) {
          throw new Error(
            "splitHtmlSafely: maxLength is too small for the current tag nesting",
          );
        }
        flush();
        continue;
      }

      if (remaining.length <= available) {
        current += remaining;
        remaining = "";
        break;
      }

      const { piece, rest } = takeUpTo(remaining, available);
      if (piece === "") {
        if (atFreshChunk) {
          // Not even one entity/character fits in a fresh chunk (maxLength is extremely tight).
          // Accept exactly one unit of bounded overflow rather than looping forever, then flush immediately.
          const unit = firstUnit(remaining);
          current += unit;
          remaining = remaining.slice(unit.length);
          flush();
          continue;
        }
        flush();
        continue;
      }

      current += piece;
      remaining = rest;
      if (remaining.length > 0) flush();
    }
  }

  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current);
  }
  return chunks;
}
