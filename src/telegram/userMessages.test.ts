import { describe, expect, it } from "vitest";
import { ContentWriteConflictError } from "@/content";
import { GroqRateLimitedError, GroqUnavailableError } from "@/rag/errors";
import {
  describeAskError,
  describeSaveError,
  extractClarifyContext,
  formatClarifyPrompt,
  formatRateLimitMessage,
  formatSaveSuccess,
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
