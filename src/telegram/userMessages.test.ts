import { describe, expect, it } from "vitest";
import { ContentWriteConflictError } from "@/content";
import { GroqRateLimitedError, GroqUnavailableError } from "@/rag/errors";
import {
  appendAskTurn,
  describeAskError,
  describeSaveError,
  extractAskTranscript,
  extractClarifyContext,
  formatAskContextBlock,
  formatClarifyPrompt,
  formatRateLimitMessage,
  formatSaveSuccess,
  isAskContinuation,
  isClarifyContinuation,
} from "./userMessages";

describe("describeAskError", () => {
  it("gives a distinct message for rate limiting", () => {
    expect(describeAskError(new GroqRateLimitedError(5))).toMatch(
      /too many questions/i,
    );
  });

  it("gives a generic message for a Groq outage", () => {
    expect(describeAskError(new GroqUnavailableError())).toMatch(
      /couldn't get an answer/i,
    );
  });

  it("falls back to a generic message for an unrecognized error", () => {
    expect(describeAskError(new Error("boom"))).not.toContain("boom");
  });
});

describe("formatRateLimitMessage", () => {
  it("formats remaining/limit for both requests and tokens", () => {
    const text = formatRateLimitMessage({
      remainingRequests: 998,
      limitRequests: 1000,
      remainingTokens: 7908,
      limitTokens: 8000,
    });
    expect(text).toContain("998/1000");
    expect(text).toContain("7908/8000");
  });
});

describe("formatClarifyPrompt / isClarifyContinuation / extractClarifyContext", () => {
  it("round-trips the original context through a formatted prompt", () => {
    const prompt = formatClarifyPrompt(
      ["Which topic?"],
      "check TCP keepalive on the LB",
    );
    expect(prompt).toContain("Which topic?");
    expect(isClarifyContinuation(prompt)).toBe(true);
    expect(extractClarifyContext(prompt)).toBe("check TCP keepalive on the LB");
  });

  it("truncates a very long echoed context", () => {
    const longContext = "x".repeat(5000);
    const prompt = formatClarifyPrompt(["Q?"], longContext);
    expect(prompt.length).toBeLessThan(longContext.length);
    expect(extractClarifyContext(prompt).endsWith("…")).toBe(true);
  });

  it("treats an ordinary message or no reply as not a continuation", () => {
    expect(isClarifyContinuation("just a normal reply")).toBe(false);
    expect(isClarifyContinuation(undefined)).toBe(false);
  });

  it("returns an empty string when the marker is missing", () => {
    expect(extractClarifyContext("no marker here")).toBe("");
  });
});

describe("formatSaveSuccess", () => {
  it("includes the path and truncates a long preview", () => {
    const text = formatSaveSuccess(
      "antonio/networking/dns.md",
      "x".repeat(500),
    );
    expect(text).toContain("antonio/networking/dns.md");
    expect(text.length).toBeLessThan(500 + 100);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("describeSaveError", () => {
  it("gives a distinct message for a write conflict", () => {
    expect(describeSaveError(new ContentWriteConflictError())).toMatch(
      /changed since it was last read/i,
    );
  });

  it("falls back to a generic message for an unrecognized error", () => {
    expect(describeSaveError(new Error("boom"))).not.toContain("boom");
  });
});

describe("appendAskTurn / isAskContinuation / extractAskTranscript / formatAskContextBlock", () => {
  it("round-trips a single turn through a formatted context block", () => {
    const transcript = appendAskTurn("", "what are embeddings?", "an answer");
    const block = formatAskContextBlock(transcript);

    expect(isAskContinuation(block)).toBe(true);
    expect(extractAskTranscript(block)).toBe(transcript);
    expect(transcript).toContain("Q: what are embeddings?");
    expect(transcript).toContain("A: an answer");
  });

  it("accumulates multiple turns in order", () => {
    let transcript = appendAskTurn("", "first question", "first answer");
    transcript = appendAskTurn(transcript, "second question", "second answer");

    expect(transcript.indexOf("first question")).toBeLessThan(
      transcript.indexOf("second question"),
    );
  });

  it("drops the oldest whole turns first once the budget is exceeded, never truncating mid-turn", () => {
    let transcript = "";
    for (let i = 0; i < 50; i++) {
      transcript = appendAskTurn(transcript, `question ${i}`, "x".repeat(100));
    }

    expect(transcript).not.toContain("question 0");
    expect(transcript).toContain("question 49");
    // Every surviving turn is complete: a Q: line always has a matching A: line.
    const qCount = (transcript.match(/^Q: /gm) ?? []).length;
    const aCount = (transcript.match(/^A: /gm) ?? []).length;
    expect(qCount).toBe(aCount);
  });

  it("returns an empty block for an empty transcript", () => {
    expect(formatAskContextBlock("")).toBe("");
  });

  it("treats an ordinary message or no reply as not a continuation", () => {
    expect(isAskContinuation("just a normal reply")).toBe(false);
    expect(isAskContinuation(undefined)).toBe(false);
  });

  it("escapes HTML-significant characters from the transcript in the formatted block", () => {
    const transcript = appendAskTurn("", "a<b>", "1 < 2 && 3 > 1");
    const block = formatAskContextBlock(transcript);

    expect(block).toContain("a&lt;b&gt;");
    expect(block).toContain("1 &lt; 2 &amp;&amp; 3 &gt; 1");
    expect(block).not.toContain("1 < 2 && 3 > 1");
  });
});
