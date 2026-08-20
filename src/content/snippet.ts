const SNIPPET_RADIUS = 40;

/** Builds a single-line, whitespace-collapsed excerpt around a search match. */
export function buildSnippet(
  content: string,
  matchIndex: number,
  matchLength: number,
): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(
    content.length,
    matchIndex + matchLength + SNIPPET_RADIUS,
  );
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  const raw = content.slice(start, end).replace(/\s+/g, " ").trim();
  return `${prefix}${raw}${suffix}`;
}
