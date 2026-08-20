import { describe, expect, it } from "vitest";
import { GroqRateLimitedError, GroqUnavailableError } from "@/rag/errors";
import { describeAskError, formatRateLimitMessage } from "./userMessages";

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
