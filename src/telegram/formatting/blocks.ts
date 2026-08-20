import MarkdownIt from "markdown-it";
import { renderCodeBlockHtml } from "./codeBlock";
import { escapeHtml } from "./html";
import { renderInlineTokens } from "./inline";
import type { Token } from "./markdownItTypes";

export type Block =
  | { kind: "heading"; html: string }
  | { kind: "paragraph"; html: string }
  | { kind: "list"; html: string }
  | { kind: "blockquote"; html: string }
  | { kind: "code"; content: string; language: string | undefined }
  | { kind: "divider"; html: string };

/** Finds the index of the token that closes the one at `openIndex`, by nesting balance (not just type). */
function findClose(
  tokens: Token[],
  openIndex: number,
  closeType: string,
): number {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.nesting === 1) {
      depth++;
    } else if (token.nesting === -1) {
      depth--;
      if (depth === 0 && token.type === closeType) return i;
    }
  }
  return tokens.length - 1;
}

function renderInlineChildAt(tokens: Token[], inlineIndex: number): string {
  return renderInlineTokens(tokens[inlineIndex]?.children ?? []);
}

interface ListItemContent {
  text: string;
  nestedListHtml: string;
}

function renderListItemContent(
  tokens: Token[],
  start: number,
  end: number,
  depth: number,
): ListItemContent {
  let text = "";
  let nestedListHtml = "";
  let i = start;

  while (i < end) {
    const token = tokens[i];
    if (token.type === "inline") {
      text = renderInlineChildAt(tokens, i);
      i++;
    } else if (token.type === "paragraph_open") {
      const closeIndex = findClose(tokens, i, "paragraph_close");
      text = renderInlineChildAt(tokens, i + 1);
      i = closeIndex + 1;
    } else if (
      token.type === "bullet_list_open" ||
      token.type === "ordered_list_open"
    ) {
      const closeType =
        token.type === "bullet_list_open"
          ? "bullet_list_close"
          : "ordered_list_close";
      const closeIndex = findClose(tokens, i, closeType);
      nestedListHtml = renderList(tokens, i, closeIndex, depth + 1);
      i = closeIndex + 1;
    } else {
      i++;
    }
  }

  return { text, nestedListHtml };
}

function renderList(
  tokens: Token[],
  openIndex: number,
  closeIndex: number,
  depth: number,
): string {
  const ordered = tokens[openIndex].type === "ordered_list_open";
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let i = openIndex + 1;

  while (i < closeIndex) {
    const token = tokens[i];
    if (token.type === "list_item_open") {
      const itemCloseIndex = findClose(tokens, i, "list_item_close");
      const { text, nestedListHtml } = renderListItemContent(
        tokens,
        i + 1,
        itemCloseIndex,
        depth,
      );
      const marker = ordered ? `${token.info || "1"}.` : "•";
      lines.push(`${indent}${marker} ${text}`);
      if (nestedListHtml) lines.push(nestedListHtml);
      i = itemCloseIndex + 1;
    } else {
      i++;
    }
  }

  return lines.join("\n");
}

/** Recursively walks a (possibly nested, e.g. inside a blockquote) slice of the token stream into flat Blocks. */
function renderBlocks(tokens: Token[], start: number, end: number): Block[] {
  const blocks: Block[] = [];
  let i = start;

  while (i < end) {
    const token = tokens[i];

    switch (token.type) {
      case "heading_open": {
        const closeIndex = findClose(tokens, i, "heading_close");
        blocks.push({
          kind: "heading",
          html: `<b>${renderInlineChildAt(tokens, i + 1)}</b>`,
        });
        i = closeIndex + 1;
        break;
      }
      case "paragraph_open": {
        const closeIndex = findClose(tokens, i, "paragraph_close");
        blocks.push({
          kind: "paragraph",
          html: renderInlineChildAt(tokens, i + 1),
        });
        i = closeIndex + 1;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const closeType =
          token.type === "bullet_list_open"
            ? "bullet_list_close"
            : "ordered_list_close";
        const closeIndex = findClose(tokens, i, closeType);
        blocks.push({
          kind: "list",
          html: renderList(tokens, i, closeIndex, 0),
        });
        i = closeIndex + 1;
        break;
      }
      case "blockquote_open": {
        const closeIndex = findClose(tokens, i, "blockquote_close");
        const inner = renderBlocks(tokens, i + 1, closeIndex);
        const innerHtml = inner
          .map((block) =>
            block.kind === "code"
              ? renderCodeBlockHtml(block.content, block.language)
              : block.html,
          )
          .join("\n\n");
        blocks.push({
          kind: "blockquote",
          html: `<blockquote>${innerHtml}</blockquote>`,
        });
        i = closeIndex + 1;
        break;
      }
      case "fence":
      case "code_block": {
        const language = token.info.trim().split(/\s+/)[0] || undefined;
        blocks.push({
          kind: "code",
          content: token.content.replace(/\n$/, ""),
          language,
        });
        i++;
        break;
      }
      case "hr":
        blocks.push({ kind: "divider", html: "──────────" });
        i++;
        break;
      case "html_block":
        // Raw HTML in source markdown isn't executed as Telegram markup — shown as plain escaped text instead.
        blocks.push({
          kind: "paragraph",
          html: escapeHtml(token.content.trim()),
        });
        i++;
        break;
      default:
        i++;
    }
  }

  return blocks;
}

export function parseMarkdownToBlocks(
  markdownIt: InstanceType<typeof MarkdownIt>,
  source: string,
): Block[] {
  const tokens = markdownIt.parse(source, {});
  return renderBlocks(tokens, 0, tokens.length);
}
