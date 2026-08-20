import MarkdownIt from "markdown-it";
import type { Document } from "@/content";
import { assembleMessages, type RenderedMessage } from "./assembleMessages";
import { parseMarkdownToBlocks } from "./blocks";

export type { RenderedMessage } from "./assembleMessages";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// html:false — raw HTML in source markdown is never passed through as trusted markup (see blocks.ts).
// linkify:false — only explicit [text](url) links are rendered; bare URLs stay plain text for determinism.
const markdownIt = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
});

export function renderDocumentMessages(
  document: Document,
  maxLength = TELEGRAM_MAX_MESSAGE_LENGTH,
): RenderedMessage[] {
  const blocks = parseMarkdownToBlocks(markdownIt, document.content);
  return assembleMessages(blocks, maxLength);
}
