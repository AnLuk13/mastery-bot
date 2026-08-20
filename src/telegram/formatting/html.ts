/** Telegram HTML parse_mode requires exactly these three characters escaped in text content. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Same escaping, plus quotes, for use inside an HTML attribute value (e.g. href="..."). */
export function escapeHtmlAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

const SAFE_LINK_SCHEME = /^(https?:|mailto:|tel:)/i;

/** Only http(s)/mailto/tel are rendered as clickable links; anything else (relative paths, unknown schemes) is not actionable in Telegram, so it's dropped rather than rendered as a broken link. */
export function isSafeLinkHref(href: string): boolean {
  return SAFE_LINK_SCHEME.test(href.trim());
}
