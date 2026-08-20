import { describe, expect, it } from "vitest";
import { answerQuestion, type AnswerQuestionDeps } from "./answerQuestion";
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
    capturedMessages,
  };
}

describe("answerQuestion", () => {
  it("cites sources whose retrieved chunk clears the relevance threshold", async () => {
    const deps = makeDeps();
    const result = await answerQuestion("what are embeddings?", deps);

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
    const result = await answerQuestion("q", deps);
    expect(result.rateLimit).toEqual(rateLimit);
  });

  it("omits sources whose retrieved chunk falls below the relevance threshold", async () => {
    const deps = makeDeps({ embed: async () => [0.1, 0.1] });
    const result = await answerQuestion("something unrelated", deps);
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
    const result = await answerQuestion("q", deps);
    expect(result.sources).toEqual(["a.md"]);
  });

  it("passes the retrieved context and the question to the model", async () => {
    const deps = makeDeps();
    await answerQuestion("what are embeddings?", deps);

    const [systemMessage, userMessage] = deps.capturedMessages[0];
    expect(systemMessage.role).toBe("system");
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toContain("ai-mastery/05-embeddings.md");
    expect(userMessage.content).toContain("Embeddings map text to vectors.");
    expect(userMessage.content).toContain("what are embeddings?");
  });
});
