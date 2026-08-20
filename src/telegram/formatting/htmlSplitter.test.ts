import { describe, expect, it } from "vitest";
import { splitHtmlSafely } from "./htmlSplitter";

/** True if every "&" in the string starts a complete, known entity — i.e. no entity was cut in half. */
function hasNoBrokenEntity(text: string): boolean {
  return !/&(?!(?:amp|lt|gt);)/.test(text);
}

/** True if every tag in the string has a matching open/close within the string itself. */
function hasBalancedTags(text: string): boolean {
  const stack: string[] = [];
  for (const match of text.matchAll(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s+[^<>]*)?>/g,
  )) {
    const [raw, name] = match;
    if (raw.startsWith("</")) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

describe("splitHtmlSafely", () => {
  it("returns a single chunk when the content already fits", () => {
    expect(splitHtmlSafely("<b>hello</b>", 100)).toEqual(["<b>hello</b>"]);
  });

  it("splits plain text across chunks that respect maxLength", () => {
    const html = "x".repeat(250);
    const chunks = splitHtmlSafely(html, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
    expect(chunks.join("")).toBe(html);
  });

  it("never splits inside a tag, and every chunk has balanced tags", () => {
    const html = `<b>${"word ".repeat(60)}</b>`;
    const chunks = splitHtmlSafely(html, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(hasBalancedTags(chunk)).toBe(true);
      expect(chunk).not.toMatch(/<\/?[a-zA-Z]*$/); // no dangling partial tag at the end
    }
  });

  it("reopens an open tag at the start of the next chunk after closing it to flush", () => {
    const html = `<pre><code>${"line\n".repeat(200)}</code></pre>`;
    const chunks = splitHtmlSafely(html, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith("<pre><code>")).toBe(true);
      expect(chunk.endsWith("</code></pre>")).toBe(true);
    }
  });

  it("never splits inside an HTML entity", () => {
    const html = "a &amp; b &lt; c &gt; d ".repeat(20);
    const chunks = splitHtmlSafely(html, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(hasNoBrokenEntity(chunk)).toBe(true);
    }
  });

  it("preserves reading order and total content across chunks (no tags, so a direct join recovers the original)", () => {
    const html = Array.from({ length: 30 }, (_, i) => `paragraph ${i} `).join(
      "",
    );
    const chunks = splitHtmlSafely(html, 50);
    expect(chunks.join("")).toBe(html);
  });

  it("handles nested tags (e.g. bold link) without breaking balance across a split", () => {
    const html = `<b><a href="https://example.com">${"link text ".repeat(30)}</a></b>`;
    const chunks = splitHtmlSafely(html, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(hasBalancedTags(chunk)).toBe(true);
    }
  });
});
