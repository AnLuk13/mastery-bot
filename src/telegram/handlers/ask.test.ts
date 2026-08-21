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
    groq: overrides.groq ?? {
      createChatCompletion: async () => ({
        text: "an answer",
        rateLimit: undefined,
      }),
    },
    privateFolders: overrides.privateFolders ?? [],
  };
}

describe("createAskHandler", () => {
  it("shows typing, answers as HTML, and includes source buttons", async () => {
    const { ctx, sendMessageCalls, sendTypingCalls } = createFakeBotContext({
      messageText: "what are embeddings?",
    });

    await createAskHandler(makeDeps())(ctx);

    expect(sendTypingCalls).toHaveLength(1);
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].text).toContain("an answer");
    expect(sendMessageCalls[0].parseMode).toBe("HTML");
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

  it("still attaches a (Home-only) keyboard when nothing cleared the relevance threshold", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      messageText: "something unrelated",
    });

    await createAskHandler(makeDeps({ embed: async () => [0.1, 0.1] }))(ctx);

    expect(sendMessageCalls[0].keyboard?.inline_keyboard).toEqual([
      [{ text: "🏠 Home", callback_data: "d:" }],
    ]);
  });

  it("adds a Groq-limits button when the model call reports rate-limit info", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      messageText: "what are embeddings?",
    });
    const deps = makeDeps({
      groq: {
        createChatCompletion: async () => ({
          text: "an answer",
          rateLimit: {
            remainingRequests: 998,
            limitRequests: 1000,
            remainingTokens: 7908,
            limitTokens: 8000,
          },
        }),
      },
    });

    await createAskHandler(deps)(ctx);

    const rows = sendMessageCalls[0].keyboard?.inline_keyboard;
    expect(rows?.some((row) => row[0]?.text === "📊 Groq limits")).toBe(true);
  });

  it("does nothing for a blank message", async () => {
    const { ctx, sendMessageCalls, sendTypingCalls } = createFakeBotContext({
      messageText: "   ",
    });

    await createAskHandler(makeDeps())(ctx);

    expect(sendMessageCalls).toHaveLength(0);
    expect(sendTypingCalls).toHaveLength(0);
  });

  it("embeds a reply-recoverable context block with the visible answer", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      messageText: "what are embeddings?",
    });

    await createAskHandler(makeDeps())(ctx);

    expect(sendMessageCalls[0].text).toContain("Q: what are embeddings?");
    expect(sendMessageCalls[0].text).toContain("A: an answer");
    expect(sendMessageCalls[0].text).toContain("tg-spoiler");
  });

  it("passes the prior transcript from a reply into the model call and accumulates it further", async () => {
    const capturedMessages: unknown[] = [];
    const deps = makeDeps({
      groq: {
        createChatCompletion: async (messages: unknown) => {
          capturedMessages.push(messages);
          return { text: "second answer", rateLimit: undefined };
        },
      },
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      messageText: "and what about vector search?",
      replyToMessageText:
        "an answer\n\n<tg-spoiler>💬 ⎯⎯⎯ ask-context (tap to expand, do not edit) ⎯⎯⎯\nQ: what are embeddings?\nA: an answer</tg-spoiler>",
    });

    await createAskHandler(deps)(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("Q: what are embeddings?");
    expect(prompt).toContain("A: an answer");
    expect(sendMessageCalls[0].text).toContain("Q: what are embeddings?");
    expect(sendMessageCalls[0].text).toContain(
      "Q: and what about vector search?",
    );
    expect(sendMessageCalls[0].text).toContain("A: second answer");
  });

  it("falls back to the raw replied-to text as context when it carries no ask-context marker (e.g. a prior answer too long to embed one)", async () => {
    const capturedMessages: unknown[] = [];
    const deps = makeDeps({
      groq: {
        createChatCompletion: async (messages: unknown) => {
          capturedMessages.push(messages);
          return { text: "an answer", rateLimit: undefined };
        },
      },
    });
    const { ctx } = createFakeBotContext({
      messageText: "translate that into romanian",
      replyToMessageText: "Latest news from Chișinău: some long roundup...",
    });

    await createAskHandler(deps)(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("Prior conversation");
    expect(prompt).toContain("Latest news from Chișinău");
  });

  it("starts a genuinely fresh transcript only when there's no reply at all", async () => {
    const capturedMessages: unknown[] = [];
    const deps = makeDeps({
      groq: {
        createChatCompletion: async (messages: unknown) => {
          capturedMessages.push(messages);
          return { text: "an answer", rateLimit: undefined };
        },
      },
    });
    const { ctx } = createFakeBotContext({
      messageText: "what are embeddings?",
    });

    await createAskHandler(deps)(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).not.toContain("Prior conversation");
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
