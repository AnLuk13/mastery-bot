import { describe, expect, it } from "vitest";
import type { Document } from "@/content";
import { renderDocumentMessages } from "./index";

function doc(content: string): Document {
  return { path: "x.md", name: "x.md", content };
}

describe("renderDocumentMessages", () => {
  it("renders headings", () => {
    expect(renderDocumentMessages(doc("# Title\n\n## Subtitle"))).toEqual([
      { text: "<b>Title</b>\n\n<b>Subtitle</b>", parseMode: "HTML" },
    ]);
  });

  it("renders bold and italic", () => {
    expect(renderDocumentMessages(doc("**bold** and *italic*"))).toEqual([
      { text: "<b>bold</b> and <i>italic</i>", parseMode: "HTML" },
    ]);
  });

  it("renders inline code", () => {
    expect(renderDocumentMessages(doc("Run `npm test`"))).toEqual([
      { text: "Run <code>npm test</code>", parseMode: "HTML" },
    ]);
  });

  it("renders fenced code blocks with a language class", () => {
    expect(
      renderDocumentMessages(doc("```ts\nconst x: number = 1;\n```")),
    ).toEqual([
      {
        text: '<pre><code class="language-ts">const x: number = 1;</code></pre>',
        parseMode: "HTML",
      },
    ]);
  });

  it("renders unordered and ordered lists", () => {
    const messages = renderDocumentMessages(
      doc("- a\n- b\n\n1. first\n2. second"),
    );
    expect(messages).toEqual([
      { text: "• a\n• b\n\n1. first\n2. second", parseMode: "HTML" },
    ]);
  });

  it("renders links", () => {
    expect(renderDocumentMessages(doc("[docs](https://example.com)"))).toEqual([
      { text: '<a href="https://example.com">docs</a>', parseMode: "HTML" },
    ]);
  });

  it("renders blockquotes", () => {
    expect(renderDocumentMessages(doc("> quoted"))).toEqual([
      { text: "<blockquote>quoted</blockquote>", parseMode: "HTML" },
    ]);
  });

  it("escapes special characters so Telegram never receives malformed HTML", () => {
    const messages = renderDocumentMessages(doc("if x < y && y > 0 { }"));
    expect(messages[0].text).toBe("if x &lt; y &amp;&amp; y &gt; 0 { }");
  });

  it("handles an empty document", () => {
    expect(renderDocumentMessages(doc(""))).toEqual([
      { text: "", parseMode: "HTML" },
    ]);
  });

  it("splits a long document into multiple valid messages, each within Telegram's limit", () => {
    const paragraphs = Array.from(
      { length: 100 },
      (_, i) => `Paragraph number ${i} with some extra body text.`,
    );
    const messages = renderDocumentMessages(doc(paragraphs.join("\n\n")));

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.text.length).toBeLessThanOrEqual(4096);
      expect(message.parseMode).toBe("HTML");
    }
    expect(messages.map((m) => m.text).join(" ")).toContain(paragraphs[0]);
    expect(messages.map((m) => m.text).join(" ")).toContain(paragraphs[99]);
  });

  it("splits a very long code block across messages without ever leaving an unclosed <pre><code>", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line_${i} = ${i};`);
    const content = "```python\n" + lines.join("\n") + "\n```";
    const messages = renderDocumentMessages(doc(content));

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.text.length).toBeLessThanOrEqual(4096);
      expect(
        message.text.startsWith('<pre><code class="language-python">'),
      ).toBe(true);
      expect(message.text.endsWith("</code></pre>")).toBe(true);
    }
  });

  it("never produces a message exceeding Telegram's message-length limit for a realistic mixed document", () => {
    const content = [
      "# Networking Notes",
      "",
      "TCP is a **reliable**, connection-oriented protocol. See `RFC 793`.",
      "",
      "## Handshake",
      "",
      "1. SYN",
      "2. SYN-ACK",
      "3. ACK",
      "",
      "```bash",
      "curl -v https://example.com".repeat(50),
      "```",
      "",
      "> Reliability is achieved through acknowledgment and retransmission.",
      "",
      "- flow control",
      "  - windowing",
      "- congestion control",
      "",
      "See [RFC 793](https://www.rfc-editor.org/rfc/rfc793) and [local notes](./tcp-internals.md).",
    ].join("\n");

    const messages = renderDocumentMessages(doc(content));
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.text.length).toBeLessThanOrEqual(4096);
    }
  });
});
