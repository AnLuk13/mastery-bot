import { describe, expect, it } from "vitest";
import { ContentWriteConflictError } from "@/content";
import { GroqRateLimitedError, GroqUnavailableError } from "@/rag/errors";
import {
  appendAskTurn,
  describeAdminError,
  describeAskError,
  describeSaveError,
  extractClarifyContext,
  formatAdminAddPrompt,
  formatAdminList,
  formatAdminUserAdded,
  formatAdminUserRemoved,
  formatClarifyPrompt,
  formatFallbackNotice,
  formatRateLimitMessage,
  formatSaveSuccess,
  isAdminAddContinuation,
  isClarifyContinuation,
  truncateForAskContext,
} from "./userMessages";

describe("describeAskError", () => {
  it("gives a distinct message for rate limiting, including retry timing when known", () => {
    const message = describeAskError(new GroqRateLimitedError(5));
    expect(message).toMatch(/request limit/i);
    expect(message).toContain("5s");
  });

  it("falls back to generic retry wording when no retry time is known", () => {
    expect(describeAskError(new GroqRateLimitedError())).toMatch(
      /try again shortly/i,
    );
  });

  it("gives a generic message for a Groq outage", () => {
    expect(describeAskError(new GroqUnavailableError())).toMatch(
      /couldn't get an answer/i,
    );
  });

  it("formats a longer retry wait in minutes, and an even longer one in hours", () => {
    expect(describeAskError(new GroqRateLimitedError(150))).toContain("3m");
    expect(describeAskError(new GroqRateLimitedError(7200))).toContain("2h");
  });

  it("falls back to a generic message for an unrecognized error", () => {
    expect(describeAskError(new Error("boom"))).not.toContain("boom");
  });
});

describe("formatFallbackNotice", () => {
  it("mentions today's limit when rate-limited", () => {
    const notice = formatFallbackNotice("rate-limited");
    expect(notice).toMatch(/web search/i);
    expect(notice).toMatch(/limit/i);
  });

  it("doesn't claim a limit was hit for a generic unavailable failure", () => {
    const notice = formatFallbackNotice("unavailable");
    expect(notice).toMatch(/web search/i);
    expect(notice).not.toMatch(/limit/i);
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

describe("formatAdminList", () => {
  it("distinguishes base (env) users from dynamically-added ones", () => {
    const text = formatAdminList([123], [456]);
    expect(text).toMatch(/123[\s\S]*base/i);
    expect(text).toContain("456");
  });

  it("shows (none) for an empty dynamic list", () => {
    expect(formatAdminList([123], [])).toContain("(none)");
  });
});

describe("formatAdminAddPrompt / isAdminAddContinuation", () => {
  it("recognizes its own prompt as a continuation", () => {
    expect(isAdminAddContinuation(formatAdminAddPrompt())).toBe(true);
  });

  it("does not recognize an unrelated message", () => {
    expect(isAdminAddContinuation("just a regular message")).toBe(false);
  });

  it("is false for undefined", () => {
    expect(isAdminAddContinuation(undefined)).toBe(false);
  });
});

describe("formatAdminUserAdded / formatAdminUserRemoved", () => {
  it("includes the user id in both messages", () => {
    expect(formatAdminUserAdded(555)).toContain("555");
    expect(formatAdminUserRemoved(555)).toContain("555");
  });
});

describe("describeAdminError", () => {
  it("names the missing KV config specifically", () => {
    const message = describeAdminError(
      new Error(
        "Dynamic user management requires KV_REST_API_URL/KV_REST_API_TOKEN to be configured",
      ),
    );
    expect(message).toMatch(/KV_REST_API_URL/);
  });

  it("falls back to a generic message for anything else", () => {
    expect(describeAdminError(new Error("boom"))).toMatch(/went wrong/i);
  });
});

describe("appendAskTurn", () => {
  it("produces a Q/A turn", () => {
    const transcript = appendAskTurn("", "what are embeddings?", "an answer");

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

  it("caps a single stored answer even when it alone would fit the overall budget", () => {
    const longAnswer = "y".repeat(2000);
    const transcript = appendAskTurn("", "a question", longAnswer);

    expect(transcript.length).toBeLessThan(longAnswer.length);
    expect(transcript).toContain("…");
  });
});

describe("truncateForAskContext", () => {
  it("leaves short text untouched", () => {
    expect(truncateForAskContext("short")).toBe("short");
  });

  it("truncates long text with an ellipsis", () => {
    const long = "z".repeat(1000);
    const truncated = truncateForAskContext(long);
    expect(truncated.length).toBeLessThan(long.length);
    expect(truncated.endsWith("…")).toBe(true);
  });
});
