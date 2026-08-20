import { describe, expect, it } from "vitest";
import type { AnswerQuestionDeps } from "@/rag/answerQuestion";
import { GroqUnavailableError } from "@/rag/errors";
import type { EmbeddingsIndex } from "@/rag/types";
import { createFakeBotContext } from "../testHelpers";
import { createAskHandler } from "./ask";

const index: EmbeddingsIndex = {
  model: "test",
  dimensions: 2,
  chunks: [
    {
      path: "ai-mastery/05-embeddings.md",
      heading: "5.1",
      text: "Embeddings map text to vectors.",
      vector: [1, 0],
    },
  ],
};

function makeDeps(
  overrides: Partial<AnswerQuestionDeps> = {},
): AnswerQuestionDeps {
  return {
    embed: overrides.embed ?? (async () => [1, 0]),
    index: overrides.index ?? index,
    groq: overrides.groq ?? { createChatCompletion: async () => "an answer" },
  };
}

describe("createAskHandler", () => {
  it("shows typing, answers, and includes source buttons", async () => {
    const { ctx, sendMessageCalls, sendTypingCalls } = createFakeBotContext({
      messageText: "what are embeddings?",
    });

    await createAskHandler(makeDeps())(ctx);

    expect(sendTypingCalls).toHaveLength(1);
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].text).toBe("an answer");
    expect(sendMessageCalls[0].keyboard?.inline_keyboard).toEqual([
      [
        {
          text: "📄 05-embeddings.md",
          callback_data: "f:ai-mastery/05-embeddings.md",
        },
      ],
      [{ text: "🏠 Home", callback_data: "d:" }],
    ]);
  });

  it("sends no keyboard when nothing cleared the relevance threshold", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      messageText: "something unrelated",
    });

    await createAskHandler(makeDeps({ embed: async () => [0.1, 0.1] }))(ctx);

    expect(sendMessageCalls[0].keyboard).toBeUndefined();
  });

  it("does nothing for a blank message", async () => {
    const { ctx, sendMessageCalls, sendTypingCalls } = createFakeBotContext({
      messageText: "   ",
    });

    await createAskHandler(makeDeps())(ctx);

    expect(sendMessageCalls).toHaveLength(0);
    expect(sendTypingCalls).toHaveLength(0);
  });

  it("replies with a safe message when the model call fails", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      messageText: "what are embeddings?",
    });
    const deps = makeDeps({
      groq: {
        createChatCompletion: async () => {
          throw new GroqUnavailableError();
        },
      },
    });

    await createAskHandler(deps)(ctx);

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].text).toMatch(/couldn't get an answer/i);
  });
});
