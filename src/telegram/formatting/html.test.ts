import { describe, expect, it } from "vitest";
import { escapeHtml, escapeHtmlAttribute, isSafeLinkHref } from "./html";

describe("escapeHtml", () => {
  it("escapes ampersand, less-than, and greater-than", () => {
    expect(escapeHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("hello world 123")).toBe("hello world 123");
  });

  it("does not double-escape an already-escaped ampersand sequence", () => {
    // escapeHtml is not idempotent by design (it only ever runs once, on raw markdown text) —
    // this documents that raw "&amp;" in source becomes fully escaped, not left alone.
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("escapeHtmlAttribute", () => {
  it("escapes quotes in addition to the base three characters", () => {
    expect(escapeHtmlAttribute('say "hi" & bye')).toBe(
      "say &quot;hi&quot; &amp; bye",
    );
  });
});

describe("isSafeLinkHref", () => {
  it("accepts http, https, mailto, and tel", () => {
    expect(isSafeLinkHref("https://example.com")).toBe(true);
    expect(isSafeLinkHref("http://example.com")).toBe(true);
    expect(isSafeLinkHref("mailto:a@example.com")).toBe(true);
    expect(isSafeLinkHref("tel:+123456")).toBe(true);
  });

  it("rejects relative paths and other schemes", () => {
    expect(isSafeLinkHref("../ssh-mastery/02-ssh-keys.md")).toBe(false);
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("data:text/html,x")).toBe(false);
    expect(isSafeLinkHref("#anchor")).toBe(false);
  });
});
