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

describe("GroqClient.createChatCompletion", () => {
  it("returns the completion text on success", async () => {
    const client = new GroqClient({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: jsonFetch(200, {
        choices: [{ message: { content: "hello there" } }],
      }),
    });

    const text = await client.createChatCompletion([
      { role: "user", content: "hi" },
    ]);
    expect(text).toBe("hello there");
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
