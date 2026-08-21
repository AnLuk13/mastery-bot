import { describe, expect, it } from "vitest";
import { GroqRateLimitedError, GroqUnavailableError } from "./errors";
import { GroqClient } from "./groqClient";

function jsonFetch(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  return async (): Promise<Response> =>
    new Response(JSON.stringify(body), { status, headers });
}

function failingFetch() {
  return async (): Promise<Response> => {
    throw new Error("network down");
  };
}

/** Captures the outgoing request body so tests can assert exactly what was sent. */
function capturingFetch(capturedBodies: unknown[]): typeof fetch {
  const impl = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedBodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    );
  };
  return impl as typeof fetch;
}

describe("GroqClient.createChatCompletion", () => {
  it("returns the completion text on success", async () => {
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: jsonFetch(200, {
        choices: [{ message: { content: "hello there" } }],
      }),
    });

    const result = await client.createChatCompletion([
      { role: "user", content: "hi" },
    ]);
    expect(result.text).toBe("hello there");
    expect(result.rateLimit).toBeUndefined();
  });

  it("parses rate-limit headers into the result when present", async () => {
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: jsonFetch(
        200,
        { choices: [{ message: { content: "hi there" } }] },
        {
          "x-ratelimit-remaining-requests": "998",
          "x-ratelimit-limit-requests": "1000",
          "x-ratelimit-remaining-tokens": "7908",
          "x-ratelimit-limit-tokens": "8000",
        },
      ),
    });

    const result = await client.createChatCompletion([
      { role: "user", content: "hi" },
    ]);
    expect(result.rateLimit).toEqual({
      remainingRequests: 998,
      limitRequests: 1000,
      remainingTokens: 7908,
      limitTokens: 8000,
    });
  });

  it("omits rate-limit info when headers are missing", async () => {
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: jsonFetch(200, {
        choices: [{ message: { content: "hi there" } }],
      }),
    });

    const result = await client.createChatCompletion([
      { role: "user", content: "hi" },
    ]);
    expect(result.rateLimit).toBeUndefined();
  });

  it("throws GroqUnavailableError on a network failure", async () => {
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: failingFetch(),
    });

    await expect(
      client.createChatCompletion([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(GroqUnavailableError);
  });

  it("throws GroqUnavailableError on a malformed response shape", async () => {
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: jsonFetch(200, { unexpected: true }),
    });

    await expect(
      client.createChatCompletion([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(GroqUnavailableError);
  });

  it("throws GroqRateLimitedError with retryAfterSeconds on a 429", async () => {
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: jsonFetch(
        429,
        { error: "rate limited" },
        { "retry-after": "5" },
      ),
    });

    try {
      await client.createChatCompletion([{ role: "user", content: "hi" }]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GroqRateLimitedError);
      expect((error as GroqRateLimitedError).retryAfterSeconds).toBe(5);
    }
  });

  it("throws GroqUnavailableError when the completion content is empty", async () => {
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: jsonFetch(200, {
        choices: [{ message: { content: "   " } }],
      }),
    });

    await expect(
      client.createChatCompletion([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(GroqUnavailableError);
  });

  it("omits reasoning_effort and response_format by default (compound models reject reasoning_effort outright)", async () => {
    const bodies: unknown[] = [];
    const client = new GroqClient({
      apiKey: "test-key",
      model: "groq/compound-mini",
      fetchImpl: capturingFetch(bodies),
    });

    await client.createChatCompletion([{ role: "user", content: "hi" }]);

    const body = bodies[0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("response_format");
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(700);
  });

  it("includes reasoning_effort when requested", async () => {
    const bodies: unknown[] = [];
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: capturingFetch(bodies),
    });

    await client.createChatCompletion([{ role: "user", content: "hi" }], {
      reasoningEffort: "low",
    });

    expect((bodies[0] as Record<string, unknown>).reasoning_effort).toBe("low");
  });

  it("includes response_format json_object when jsonMode is requested", async () => {
    const bodies: unknown[] = [];
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: capturingFetch(bodies),
    });

    await client.createChatCompletion([{ role: "user", content: "hi" }], {
      jsonMode: true,
    });

    expect((bodies[0] as Record<string, unknown>).response_format).toEqual({
      type: "json_object",
    });
  });

  it("throws GroqUnavailableError on a 401", async () => {
    const client = new GroqClient({
      apiKey: "bad-key",
      model: "test-model",
      fetchImpl: jsonFetch(401, { error: "unauthorized" }),
    });

    await expect(
      client.createChatCompletion([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(GroqUnavailableError);
  });
});
