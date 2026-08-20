import { describe, expect, it } from "vitest";
import { CODE_CLOSE_TAG, codeOpenTag, renderCodeBlockHtml } from "./codeBlock";

describe("codeOpenTag", () => {
  it("includes a language class when a language is given", () => {
    expect(codeOpenTag("js")).toBe('<pre><code class="language-js">');
  });

  it("omits the class when there is no language", () => {
    expect(codeOpenTag(undefined)).toBe("<pre><code>");
  });
});

describe("renderCodeBlockHtml", () => {
  it("wraps and escapes code content", () => {
    expect(renderCodeBlockHtml("if (a < b) { return a & b; }", "js")).toBe(
      `<pre><code class="language-js">if (a &lt; b) { return a &amp; b; }</code></pre>`,
    );
  });

  it("closes with the shared CODE_CLOSE_TAG constant", () => {
    expect(renderCodeBlockHtml("x", undefined).endsWith(CODE_CLOSE_TAG)).toBe(
      true,
    );
  });
});
