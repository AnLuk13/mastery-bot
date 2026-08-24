import { escapeHtml, escapeHtmlAttribute, isSafeLinkHref } from "./html";
import type { Token } from "./markdownItTypes";

/**
 * Renders markdown-it inline children to the restricted HTML subset Telegram
 * supports. All text content is escaped here — this is the one place raw
 * Markdown source characters become HTML, so every other module downstream
 * can assume `<`/`>`/`&` in a string are always part of a real tag or a
 * `&...;` entity, never literal content. That invariant is what makes the
 * tag-aware splitter (htmlSplitter.ts) safe.
 */
export function renderInlineTokens(children: Token[]): string {
  let html = "";
  const linkIsClickableStack: boolean[] = [];

  for (const token of children) {
    switch (token.type) {
      case "text":
        html += escapeHtml(token.content);
        break;
      case "code_inline":
        html += `<code>${escapeHtml(token.content)}</code>`;
        break;
      case "strong_open":
        html += "<b>";
        break;
      case "strong_close":
        html += "</b>";
        break;
      case "em_open":
        html += "<i>";
        break;
      case "em_close":
        html += "</i>";
        break;
      case "link_open": {
        const rawHref = token.attrGet("href");
        const href = typeof rawHref === "string" ? rawHref : "";
        const clickable = isSafeLinkHref(href);
        linkIsClickableStack.push(clickable);
        if (clickable) {
          html += `<a href="${escapeHtmlAttribute(href)}">`;
        }
        break;
      }
      case "link_close":
        // Link text always renders; the wrapping <a> only appears if the href was a safe scheme.
        if (linkIsClickableStack.pop()) html += "</a>";
        break;
      case "softbreak":
      case "hardbreak":
        html += "\n";
        break;
      case "image":
        html += escapeHtml(token.content || "[image]");
        break;
      default:
        if (typeof token.content === "string" && token.content) {
          html += escapeHtml(token.content);
        }
    }
  }

  return html;
}

/**
 * Plain-text sibling of renderInlineTokens — strips emphasis/link markup
 * instead of converting it to HTML, and returns unescaped text (the caller
 * is responsible for escaping, e.g. via renderCodeBlockHtml). Used for table
 * cells, which render as a plain-text/monospace block (see blocks.ts) rather
 * than Telegram HTML, since Telegram's HTML mode has no <table> support.
 */
export function renderInlinePlainText(children: Token[]): string {
  let text = "";
  for (const token of children) {
    switch (token.type) {
      case "text":
      case "code_inline":
        text += token.content;
        break;
      case "softbreak":
      case "hardbreak":
        text += " ";
        break;
      case "image":
        text += token.content || "[image]";
        break;
      case "strong_open":
      case "strong_close":
      case "em_open":
      case "em_close":
      case "link_open":
      case "link_close":
        break;
      default:
        if (typeof token.content === "string") text += token.content;
    }
  }
  return text;
}
