import type { Block } from "./blocks";
import { CODE_CLOSE_TAG, codeOpenTag, renderCodeBlockHtml } from "./codeBlock";
import { escapeHtml } from "./html";
import { splitHtmlSafely } from "./htmlSplitter";

export interface RenderedMessage {
  text: string;
  parseMode: "HTML";
}

/**
 * Splits an oversized code block at line boundaries (never mid-line if
 * avoidable), re-opening a fresh <pre><code> per resulting chunk since each
 * chunk becomes an independent Telegram message and tags can't span
 * messages. If a single line alone is still too long, that line is hard-split
 * by character (never inside a produced HTML entity).
 */
function splitCodeBlock(
  content: string,
  language: string | undefined,
  maxLength: number,
): string[] {
  const open = codeOpenTag(language);
  const budget = maxLength - open.length - CODE_CLOSE_TAG.length;
  const lines = content.split("\n");
  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentLen = 0;

  const flushLines = () => {
    if (currentLines.length === 0) return;
    chunks.push(
      `${open}${escapeHtml(currentLines.join("\n"))}${CODE_CLOSE_TAG}`,
    );
    currentLines = [];
    currentLen = 0;
  };

  for (const line of lines) {
    const lineLen = escapeHtml(line).length;

    if (lineLen > budget) {
      flushLines();
      for (const piece of hardSliceRawText(line, budget)) {
        chunks.push(`${open}${escapeHtml(piece)}${CODE_CLOSE_TAG}`);
      }
      continue;
    }

    const addition = currentLines.length === 0 ? lineLen : lineLen + 1; // +1 for the joining "\n"
    if (currentLen + addition > budget) {
      flushLines();
    }
    currentLines.push(line);
    currentLen = currentLines.length === 1 ? lineLen : currentLen + addition;
  }

  flushLines();
  return chunks.length > 0 ? chunks : [`${open}${CODE_CLOSE_TAG}`];
}

/** Slices raw (unescaped) text by Unicode code point so escaping afterward can never push a piece over budget unpredictably. */
function hardSliceRawText(text: string, budget: number): string[] {
  const pieces: string[] = [];
  let current = "";
  let currentEscapedLen = 0;

  for (const char of text) {
    const escapedLen = escapeHtml(char).length;
    if (currentEscapedLen + escapedLen > budget && current !== "") {
      pieces.push(current);
      current = "";
      currentEscapedLen = 0;
    }
    current += char;
    currentEscapedLen += escapedLen;
  }
  if (current !== "" || pieces.length === 0) pieces.push(current);
  return pieces;
}

/**
 * Joins rendered blocks into Telegram messages, preferring to break between
 * blocks (heading/paragraph/list/code-block boundaries) and only splitting
 * inside a single block when that block alone exceeds maxLength.
 */
export function assembleMessages(
  blocks: Block[],
  maxLength: number,
): RenderedMessage[] {
  const messages: RenderedMessage[] = [];
  let current = "";

  const flush = () => {
    if (current !== "") {
      messages.push({ text: current, parseMode: "HTML" });
      current = "";
    }
  };

  const append = (html: string) => {
    const candidate = current === "" ? html : `${current}\n\n${html}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      return;
    }

    flush();

    if (html.length <= maxLength) {
      current = html;
      return;
    }

    for (const chunk of splitHtmlSafely(html, maxLength)) {
      messages.push({ text: chunk, parseMode: "HTML" });
    }
  };

  for (const block of blocks) {
    if (block.kind === "code") {
      const whole = renderCodeBlockHtml(block.content, block.language);
      if (whole.length <= maxLength) {
        append(whole);
      } else {
        flush();
        for (const chunk of splitCodeBlock(
          block.content,
          block.language,
          maxLength,
        )) {
          messages.push({ text: chunk, parseMode: "HTML" });
        }
      }
      continue;
    }
    append(block.html);
  }

  flush();
  return messages.length > 0 ? messages : [{ text: "", parseMode: "HTML" }];
}
