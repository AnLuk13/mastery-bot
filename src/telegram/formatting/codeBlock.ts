import { escapeHtml, escapeHtmlAttribute } from "./html";

export function codeOpenTag(language: string | undefined): string {
  return language
    ? `<pre><code class="language-${escapeHtmlAttribute(language)}">`
    : "<pre><code>";
}

export const CODE_CLOSE_TAG = "</code></pre>";

export function renderCodeBlockHtml(
  content: string,
  language: string | undefined,
): string {
  return `${codeOpenTag(language)}${escapeHtml(content)}${CODE_CLOSE_TAG}`;
}
