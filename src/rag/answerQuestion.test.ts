import { describe, expect, it } from "vitest";
import { answerQuestion, type AnswerQuestionDeps } from "./answerQuestion";
import { GroqRateLimitedError, GroqUnavailableError } from "./errors";
import type { ChatMessage } from "./groqClient";
import type { EmbeddingsIndex } from "./types";

const index: EmbeddingsIndex = {
  model: "test",
  dimensions: 2,
  chunks: [
    {
      path: "ai-mastery/05-embeddings.md",
      heading: "5.1 What embeddings are",
      text: "Embeddings map text to vectors.",
      vector: [1, 0],
    },
    {
      path: "networking-mastery/08-http.md",
      heading: "8.1 Requests",
      text: "HTTP requests have a method and headers.",
      vector: [0, 1],
    },
  ],
};

function makeDeps(
  overrides: Partial<AnswerQuestionDeps> = {},
): AnswerQuestionDeps & {
  capturedMessages: ChatMessage[][];
} {
  const capturedMessages: ChatMessage[][] = [];
  return {
    embed: overrides.embed ?? (async () => [1, 0]),
    index: overrides.index ?? index,
    groq: overrides.groq ?? {
      createChatCompletion: async (messages: ChatMessage[]) => {
        capturedMessages.push(messages);
        return { text: "a generated answer", rateLimit: undefined };
      },
    },
    privateFolders: overrides.privateFolders ?? [],
    capturedMessages,
  };
}

describe("answerQuestion", () => {
  it("cites sources whose retrieved chunk clears the relevance threshold", async () => {
    const deps = makeDeps();
    const result = await answerQuestion(
      "what are embeddings?",
      undefined,
      deps,
    );

    expect(result.text).toBe("a generated answer");
    expect(result.sources).toEqual(["ai-mastery/05-embeddings.md"]);
  });

  it("propagates rate-limit info from the model call", async () => {
    const rateLimit = {
      remainingRequests: 1,
      limitRequests: 2,
      remainingTokens: 3,
      limitTokens: 4,
    };
    const deps = makeDeps({
      groq: {
        createChatCompletion: async () => ({ text: "answer", rateLimit }),
      },
    });
    const result = await answerQuestion("q", undefined, deps);
    expect(result.rateLimit).toEqual(rateLimit);
  });

  it("omits sources whose retrieved chunk falls below the relevance threshold", async () => {
    const deps = makeDeps({ embed: async () => [0.1, 0.1] });
    const result = await answerQuestion("something unrelated", undefined, deps);
    expect(result.sources).toEqual([]);
  });

  it("deduplicates sources cited by more than one retrieved chunk", async () => {
    const deps = makeDeps({
      index: {
        model: "test",
        dimensions: 2,
        chunks: [
          { path: "a.md", heading: "1", text: "x", vector: [1, 0] },
          { path: "a.md", heading: "2", text: "y", vector: [1, 0] },
        ],
      },
    });
    const result = await answerQuestion("q", undefined, deps);
    expect(result.sources).toEqual(["a.md"]);
  });

  it("excludes chunks from a folder private to another user, both from context and citations", async () => {
    const deps = makeDeps({
      privateFolders: [{ folder: "ai-mastery", ownerId: 712059530 }],
    });
    const result = await answerQuestion("what are embeddings?", 999, deps);

    expect(result.sources).toEqual([]);
    const userMessage = deps.capturedMessages[0][1];
    expect(userMessage.content).not.toContain("ai-mastery/05-embeddings.md");
    expect(userMessage.content).not.toContain(
      "Embeddings map text to vectors.",
    );
  });

  it("still includes a private chunk when the asker is its owner", async () => {
    const deps = makeDeps({
      privateFolders: [{ folder: "ai-mastery", ownerId: 712059530 }],
    });
    const result = await answerQuestion(
      "what are embeddings?",
      712059530,
      deps,
    );

    expect(result.sources).toEqual(["ai-mastery/05-embeddings.md"]);
  });

  it("passes the retrieved context and the question to the model", async () => {
    const deps = makeDeps();
    await answerQuestion("what are embeddings?", undefined, deps);

    const [systemMessage, userMessage] = deps.capturedMessages[0];
    expect(systemMessage.role).toBe("system");
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toContain("ai-mastery/05-embeddings.md");
    expect(userMessage.content).toContain("Embeddings map text to vectors.");
    expect(userMessage.content).toContain("what are embeddings?");
  });

  it("includes prior transcript in the prompt when provided", async () => {
    const deps = makeDeps();
    await answerQuestion(
      "and what about vector search?",
      undefined,
      deps,
      "Q: what are embeddings?\nA: they map text to vectors.",
    );

    const userMessage = deps.capturedMessages[0][1];
    expect(userMessage.content).toContain("Prior conversation in this thread");
    expect(userMessage.content).toContain("Q: what are embeddings?");
    expect(userMessage.content).toContain("and what about vector search?");
  });

  it("embeds the prior transcript together with a pronoun-heavy follow-up for retrieval", async () => {
    let embedInput: string | undefined;
    const deps = makeDeps({
      embed: async (text) => {
        embedInput = text;
        return [1, 0];
      },
    });

    await answerQuestion(
      "summarize that",
      undefined,
      deps,
      "Q: what are embeddings?\nA: they map text to vectors.",
    );

    expect(embedInput).toContain("what are embeddings?");
    expect(embedInput).toContain("summarize that");
  });

  it("omits the prior-conversation block entirely when no transcript is given", async () => {
    const deps = makeDeps();
    await answerQuestion("what are embeddings?", undefined, deps);

    const userMessage = deps.capturedMessages[0][1];
    expect(userMessage.content).not.toContain("Prior conversation");
  });

  it("includes a reference document's content in the prompt, framed distinctly from prior conversation", async () => {
    const deps = makeDeps();
    await answerQuestion("summarize this", undefined, deps, "", {
      path: "ai-mastery/05-embeddings.md",
      content: "The full document text about embeddings.",
    });

    const userMessage = deps.capturedMessages[0][1];
    expect(userMessage.content).toContain(
      "The full document text about embeddings.",
    );
    expect(userMessage.content).toContain("ai-mastery/05-embeddings.md");
    expect(userMessage.content).not.toContain("Prior conversation");
  });

  it("omits the reference-document block when none is given", async () => {
    const deps = makeDeps();
    await answerQuestion("what are embeddings?", undefined, deps);

    const userMessage = deps.capturedMessages[0][1];
    expect(userMessage.content).not.toContain("just viewing");
  });

  it("sets usedFallback: false on a normal successful answer", async () => {
    const deps = makeDeps();
    const result = await answerQuestion(
      "what are embeddings?",
      undefined,
      deps,
    );
    expect(result.usedFallback).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
    expect(result.hasWebSearch).toBe(true);
  });

  describe("two-tier compound fallback", () => {
    it("tries the second compound model before giving up web search, and keeps hasWebSearch true", async () => {
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new GroqRateLimitedError();
          },
        },
      });
      const webSearchFallbackGroq = {
        createChatCompletion: async () => ({
          text: "answer from the second compound model",
          rateLimit: undefined,
        }),
      };

      const result = await answerQuestion("what are embeddings?", undefined, {
        ...deps,
        webSearchFallbackGroq,
      });

      expect(result.text).toBe("answer from the second compound model");
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toBe("rate-limited");
      expect(result.hasWebSearch).toBe(true);
    });

    it("does not pass reasoningEffort to the second compound model — it rejects that option like the primary", async () => {
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new GroqRateLimitedError();
          },
        },
      });
      const calls: unknown[] = [];
      const webSearchFallbackGroq = {
        createChatCompletion: async (
          _messages: ChatMessage[],
          options: unknown,
        ) => {
          calls.push(options);
          return { text: "answer", rateLimit: undefined };
        },
      };

      await answerQuestion("what are embeddings?", undefined, {
        ...deps,
        webSearchFallbackGroq,
      });

      expect(calls[0]).toBeUndefined();
    });

    it("falls all the way to the structured no-search model when both compound models fail", async () => {
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new GroqRateLimitedError();
          },
        },
      });
      const webSearchFallbackGroq = {
        createChatCompletion: async () => {
          throw new GroqRateLimitedError();
        },
      };
      const fallbackGroq = {
        createChatCompletion: async () => ({
          text: "structured fallback answer",
          rateLimit: undefined,
        }),
      };

      const result = await answerQuestion("what are embeddings?", undefined, {
        ...deps,
        webSearchFallbackGroq,
        fallbackGroq,
      });

      expect(result.text).toBe("structured fallback answer");
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toBe("rate-limited");
      expect(result.hasWebSearch).toBe(false);
    });

    it("propagates the second compound model's error when there's no structured fallback configured", async () => {
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new GroqRateLimitedError();
          },
        },
      });
      const webSearchFallbackGroq = {
        createChatCompletion: async () => {
          throw new GroqUnavailableError();
        },
      };

      await expect(
        answerQuestion("what are embeddings?", undefined, {
          ...deps,
          webSearchFallbackGroq,
        }),
      ).rejects.toThrow(GroqUnavailableError);
    });

    it("doesn't try the second compound model when the primary's error isn't retryable", async () => {
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new Error("something unrelated broke");
          },
        },
      });
      let called = false;
      const webSearchFallbackGroq = {
        createChatCompletion: async () => {
          called = true;
          return { text: "should never be reached", rateLimit: undefined };
        },
      };

      await expect(
        answerQuestion("what are embeddings?", undefined, {
          ...deps,
          webSearchFallbackGroq,
        }),
      ).rejects.toThrow("something unrelated broke");
      expect(called).toBe(false);
    });
  });

  describe("fallback model", () => {
    it("falls back and answers when the primary model is rate-limited", async () => {
      const fallbackMessages: ChatMessage[][] = [];
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new GroqRateLimitedError(5);
          },
        },
      });
      const fallbackGroq = {
        createChatCompletion: async (messages: ChatMessage[]) => {
          fallbackMessages.push(messages);
          return { text: "fallback answer", rateLimit: undefined };
        },
      };

      const result = await answerQuestion("what are embeddings?", undefined, {
        ...deps,
        fallbackGroq,
      });

      expect(result.text).toBe("fallback answer");
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toBe("rate-limited");
      expect(result.hasWebSearch).toBe(false);
      expect(fallbackMessages).toHaveLength(1);
    });

    it("falls back on a generic Groq outage too, not just rate limiting", async () => {
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new GroqUnavailableError();
          },
        },
      });
      const fallbackGroq = {
        createChatCompletion: async () => ({
          text: "fallback answer",
          rateLimit: undefined,
        }),
      };

      const result = await answerQuestion("what are embeddings?", undefined, {
        ...deps,
        fallbackGroq,
      });

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toBe("unavailable");
    });

    it("passes reasoningEffort to the fallback call and omits the web-search claim from its system prompt", async () => {
      const fallbackCalls: { messages: ChatMessage[]; options: unknown }[] = [];
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new GroqRateLimitedError();
          },
        },
      });
      const fallbackGroq = {
        createChatCompletion: async (
          messages: ChatMessage[],
          options: unknown,
        ) => {
          fallbackCalls.push({ messages, options });
          return { text: "fallback answer", rateLimit: undefined };
        },
      };

      await answerQuestion("what are embeddings?", undefined, {
        ...deps,
        fallbackGroq,
      });

      expect(fallbackCalls[0].options).toEqual({ reasoningEffort: "low" });
      expect(fallbackCalls[0].messages[0].content).not.toContain(
        "live web search",
      );
    });

    it("propagates the original error when there's no fallback configured", async () => {
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new GroqRateLimitedError();
          },
        },
      });

      await expect(
        answerQuestion("what are embeddings?", undefined, deps),
      ).rejects.toThrow(GroqRateLimitedError);
    });

    it("propagates a non-rate-limit, non-unavailable error even when a fallback is configured", async () => {
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new Error("something unrelated broke");
          },
        },
      });
      const fallbackGroq = {
        createChatCompletion: async () => ({
          text: "should never be reached",
          rateLimit: undefined,
        }),
      };

      await expect(
        answerQuestion("what are embeddings?", undefined, {
          ...deps,
          fallbackGroq,
        }),
      ).rejects.toThrow("something unrelated broke");
    });

    it("propagates the fallback's own error when the fallback also fails", async () => {
      const deps = makeDeps({
        groq: {
          createChatCompletion: async () => {
            throw new GroqRateLimitedError();
          },
        },
      });
      const fallbackGroq = {
        createChatCompletion: async () => {
          throw new GroqUnavailableError();
        },
      };

      await expect(
        answerQuestion("what are embeddings?", undefined, {
          ...deps,
          fallbackGroq,
        }),
      ).rejects.toThrow(GroqUnavailableError);
    });
  });
});
