import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { parseMarkdownToBlocks } from "./blocks";

const md = new MarkdownIt({ html: false, linkify: false });
const parse = (source: string) => parseMarkdownToBlocks(md, source);

describe("parseMarkdownToBlocks", () => {
  it("renders a heading as bold", () => {
    expect(parse("# Title")).toEqual([
      { kind: "heading", html: "<b>Title</b>" },
    ]);
  });

  it("renders headings of any level the same way", () => {
    expect(parse("### Sub")).toEqual([{ kind: "heading", html: "<b>Sub</b>" }]);
  });

  it("renders a plain paragraph", () => {
    expect(parse("Just text.")).toEqual([
      { kind: "paragraph", html: "Just text." },
    ]);
  });

  it("renders bold and italic", () => {
    expect(parse("**bold** and *italic*")).toEqual([
      { kind: "paragraph", html: "<b>bold</b> and <i>italic</i>" },
    ]);
  });

  it("renders inline code, escaping its content", () => {
    expect(parse("Use `a < b` here")).toEqual([
      { kind: "paragraph", html: "Use <code>a &lt; b</code> here" },
    ]);
  });

  it("escapes raw special characters in plain text", () => {
    expect(parse("if a < b & c > d")).toEqual([
      { kind: "paragraph", html: "if a &lt; b &amp; c &gt; d" },
    ]);
  });

  it("renders a safe link as a clickable anchor", () => {
    expect(parse("[TCP](https://example.com/tcp)")).toEqual([
      { kind: "paragraph", html: '<a href="https://example.com/tcp">TCP</a>' },
    ]);
  });

  it("renders an unsafe/relative link as plain text, not a broken anchor", () => {
    expect(parse("[keys](../ssh-mastery/02-ssh-keys.md)")).toEqual([
      { kind: "paragraph", html: "keys" },
    ]);
  });

  it("renders an unordered list with bullet markers", () => {
    expect(parse("- one\n- two\n- three")).toEqual([
      { kind: "list", html: "• one\n• two\n• three" },
    ]);
  });

  it("renders an ordered list preserving its starting number", () => {
    expect(parse("5. five\n6. six")).toEqual([
      { kind: "list", html: "5. five\n6. six" },
    ]);
  });

  it("renders a nested list with indentation", () => {
    const blocks = parse("- parent\n  - child one\n  - child two\n- sibling");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("list");
    if (blocks[0].kind === "list") {
      expect(blocks[0].html).toBe(
        "• parent\n  • child one\n  • child two\n• sibling",
      );
    }
  });

  it("renders a blockquote", () => {
    expect(parse("> quoted text")).toEqual([
      { kind: "blockquote", html: "<blockquote>quoted text</blockquote>" },
    ]);
  });

  it("renders a fenced code block with its language", () => {
    expect(parse("```js\nconsole.log(1)\n```")).toEqual([
      { kind: "code", content: "console.log(1)", language: "js" },
    ]);
  });

  it("renders a fenced code block without a language", () => {
    expect(parse("```\nplain\n```")).toEqual([
      { kind: "code", content: "plain", language: undefined },
    ]);
  });

  it("renders an indented code block", () => {
    expect(parse("    indented code")).toEqual([
      { kind: "code", content: "indented code", language: undefined },
    ]);
  });

  it("renders a horizontal rule as a divider block", () => {
    expect(parse("---")).toEqual([{ kind: "divider", html: "──────────" }]);
  });

  describe("tables", () => {
    it("renders a GFM table as an aligned plain-text code block, not silently dropped", () => {
      const source = [
        "| Fuel type | Price (MDL / L) |",
        "|-----------|----------------|",
        "| Diesel    | **31.98 MDL** |",
        "| Gasoline  | **30.12 MDL** |",
      ].join("\n");

      expect(parse(source)).toEqual([
        {
          kind: "code",
          content: [
            "Fuel type | Price (MDL / L)",
            "----------|----------------",
            "Diesel    | 31.98 MDL",
            "Gasoline  | 30.12 MDL",
          ].join("\n"),
          language: undefined,
        },
      ]);
    });

    it("strips inline formatting from cells to plain text rather than leaking markup", () => {
      const source = ["| A | B |", "|---|---|", "| [x](y) | `code` |"].join(
        "\n",
      );
      const blocks = parse(source);
      expect(blocks[0].kind).toBe("code");
      expect((blocks[0] as { content: string }).content).not.toMatch(/<|>/);
    });

    it("renders surrounding paragraphs normally around a table", () => {
      const source = [
        "Before.",
        "",
        "| A |",
        "|---|",
        "| 1 |",
        "",
        "After.",
      ].join("\n");
      const blocks = parse(source);
      expect(blocks.map((b) => b.kind)).toEqual([
        "paragraph",
        "code",
        "paragraph",
      ]);
    });
  });

  it("does not treat raw inline HTML in source as trusted markup", () => {
    const blocks = parse("<script>alert(1)</script>");
    expect(blocks).toEqual([
      { kind: "paragraph", html: "&lt;script&gt;alert(1)&lt;/script&gt;" },
    ]);
  });

  it("returns no blocks for empty content", () => {
    expect(parse("")).toEqual([]);
  });

  it("handles a realistic multi-construct document without throwing", () => {
    const source = [
      "# Networking",
      "",
      "TCP uses a **three-way handshake**: `SYN`, `SYN-ACK`, `ACK`.",
      "",
      "## Steps",
      "",
      "1. Client sends SYN",
      "2. Server responds",
      "",
      "```bash",
      "curl -v https://example.com",
      "```",
      "",
      "> See [RFC 793](https://www.rfc-editor.org/rfc/rfc793) for details.",
    ].join("\n");

    const blocks = parse(source);
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list",
      "code",
      "blockquote",
    ]);
  });
});
