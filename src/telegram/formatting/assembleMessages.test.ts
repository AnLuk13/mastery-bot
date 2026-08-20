import { describe, expect, it } from "vitest";
import { assembleMessages } from "./assembleMessages";
import type { Block } from "./blocks";

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

describe("assembleMessages", () => {
  it("returns a single empty message for no blocks", () => {
    expect(assembleMessages([], 4096)).toEqual([
      { text: "", parseMode: "HTML" },
    ]);
  });

  it("joins small blocks into a single message separated by blank lines", () => {
    const blocks: Block[] = [
      { kind: "heading", html: "<b>Title</b>" },
      { kind: "paragraph", html: "Body text." },
    ];
    expect(assembleMessages(blocks, 4096)).toEqual([
      { text: "<b>Title</b>\n\nBody text.", parseMode: "HTML" },
    ]);
  });

  it("starts a new message once accumulated blocks would exceed maxLength", () => {
    const blocks: Block[] = [
      { kind: "paragraph", html: "a".repeat(40) },
      { kind: "paragraph", html: "b".repeat(40) },
      { kind: "paragraph", html: "c".repeat(40) },
    ];
    const messages = assembleMessages(blocks, 90);
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages)
      expect(message.text.length).toBeLessThanOrEqual(90);
    expect(messages.map((m) => m.text).join("\n\n")).toContain("a".repeat(40));
  });

  it("hard-splits a single oversized non-code block across messages with balanced tags", () => {
    const blocks: Block[] = [
      { kind: "paragraph", html: `<b>${"word ".repeat(500)}</b>` },
    ];
    const messages = assembleMessages(blocks, 200);
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.text.length).toBeLessThanOrEqual(200);
      expect(hasBalancedTags(message.text)).toBe(true);
    }
  });

  it("keeps a code block that fits as one message, wrapped in pre/code", () => {
    const blocks: Block[] = [
      { kind: "code", content: "const x = 1;", language: "js" },
    ];
    const messages = assembleMessages(blocks, 4096);
    expect(messages).toEqual([
      {
        text: '<pre><code class="language-js">const x = 1;</code></pre>',
        parseMode: "HTML",
      },
    ]);
  });

  it("does not merge a code block into the same message as surrounding paragraphs when it would still fit (still uses the shared boundary logic)", () => {
    const blocks: Block[] = [
      { kind: "paragraph", html: "Before." },
      { kind: "code", content: "x = 1", language: undefined },
      { kind: "paragraph", html: "After." },
    ];
    const [message] = assembleMessages(blocks, 4096);
    expect(message.text).toBe(
      "Before.\n\n<pre><code>x = 1</code></pre>\n\nAfter.",
    );
  });

  it("splits an oversized code block at line boundaries, re-wrapping pre/code on every chunk", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `console.log(${i});`);
    const blocks: Block[] = [
      { kind: "code", content: lines.join("\n"), language: "js" },
    ];
    const messages = assembleMessages(blocks, 300);

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.text.length).toBeLessThanOrEqual(300);
      expect(message.text.startsWith('<pre><code class="language-js">')).toBe(
        true,
      );
      expect(message.text.endsWith("</code></pre>")).toBe(true);
    }

    // No line was split: every original line appears intact in exactly one chunk.
    const rejoined = messages
      .map((m) =>
        m.text
          .replace('<pre><code class="language-js">', "")
          .replace("</code></pre>", ""),
      )
      .join("\n");
    for (const line of lines) {
      expect(rejoined).toContain(line);
    }
  });

  it("hard-splits a single line that alone exceeds the budget within a code block", () => {
    const hugeLine = "x".repeat(500);
    const blocks: Block[] = [
      { kind: "code", content: hugeLine, language: undefined },
    ];
    const messages = assembleMessages(blocks, 100);

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.text.length).toBeLessThanOrEqual(100);
      expect(message.text.startsWith("<pre><code>")).toBe(true);
      expect(message.text.endsWith("</code></pre>")).toBe(true);
    }
  });

  it("preserves block reading order across multiple messages", () => {
    const blocks: Block[] = [
      { kind: "heading", html: "<b>1</b>" },
      { kind: "paragraph", html: "x".repeat(60) },
      { kind: "heading", html: "<b>2</b>" },
      { kind: "paragraph", html: "y".repeat(60) },
    ];
    const messages = assembleMessages(blocks, 90);
    const order = messages.map((m) => m.text).join("|||");
    expect(order.indexOf("1")).toBeLessThan(order.indexOf("2"));
    expect(order.indexOf("x")).toBeLessThan(order.indexOf("y"));
  });
});
