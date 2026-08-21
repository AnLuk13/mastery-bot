import { describe, expect, it } from "vitest";
import type { AnswerQuestionDeps } from "@/rag/answerQuestion";
import { GroqUnavailableError } from "@/rag/errors";
import type { EmbeddingsIndex } from "@/rag/types";
import type { Document } from "@/content";
import {
  createFakeBotContext,
  createFakeContentProvider,
  createFakeSessionStore,
} from "../testHelpers";
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
      userId: 1,
      messageText: "what are embeddings?",
    });

    await createAskHandler(
      makeDeps(),
      createFakeContentProvider(),
      createFakeSessionStore(),
    )(ctx);

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
      userId: 1,
      messageText: "something unrelated",
    });

    await createAskHandler(
      makeDeps({ embed: async () => [0.1, 0.1] }),
      createFakeContentProvider(),
      createFakeSessionStore(),
    )(ctx);

    expect(sendMessageCalls[0].keyboard?.inline_keyboard).toEqual([
      [{ text: "🏠 Home", callback_data: "d:" }],
    ]);
  });

  it("adds a Groq-limits button when the model call reports rate-limit info", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 1,
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

    await createAskHandler(
      deps,
      createFakeContentProvider(),
      createFakeSessionStore(),
    )(ctx);

    const rows = sendMessageCalls[0].keyboard?.inline_keyboard;
    expect(rows?.some((row) => row[0]?.text === "📊 Groq limits")).toBe(true);
  });

  it("does nothing for a blank message", async () => {
    const { ctx, sendMessageCalls, sendTypingCalls } = createFakeBotContext({
      userId: 1,
      messageText: "   ",
    });

    await createAskHandler(
      makeDeps(),
      createFakeContentProvider(),
      createFakeSessionStore(),
    )(ctx);

    expect(sendMessageCalls).toHaveLength(0);
    expect(sendTypingCalls).toHaveLength(0);
  });

  it("does nothing when there is no authenticated user", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      messageText: "what are embeddings?",
    });

    await createAskHandler(
      makeDeps(),
      createFakeContentProvider(),
      createFakeSessionStore(),
    )(ctx);

    expect(sendMessageCalls).toHaveLength(0);
  });

  it("passes the stored session transcript into the model call and saves the accumulated result", async () => {
    const capturedMessages: unknown[] = [];
    const deps = makeDeps({
      groq: {
        createChatCompletion: async (messages: unknown) => {
          capturedMessages.push(messages);
          return { text: "second answer", rateLimit: undefined };
        },
      },
    });
    const sessionStore = createFakeSessionStore({
      1: { transcript: "Q: what are embeddings?\nA: an answer" },
    });
    const { ctx } = createFakeBotContext({
      userId: 1,
      messageText: "and what about vector search?",
    });

    await createAskHandler(
      deps,
      createFakeContentProvider(),
      sessionStore,
    )(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("Q: what are embeddings?");
    expect(prompt).toContain("and what about vector search?");

    const saved = await sessionStore.get(1);
    expect(saved.transcript).toContain("Q: what are embeddings?");
    expect(saved.transcript).toContain("Q: and what about vector search?");
    expect(saved.transcript).toContain("A: second answer");
  });

  it("starts a genuinely fresh transcript when no session exists yet", async () => {
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
      userId: 1,
      messageText: "what are embeddings?",
    });

    await createAskHandler(
      deps,
      createFakeContentProvider(),
      createFakeSessionStore(),
    )(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).not.toContain("Prior conversation");
  });

  it("pulls in the last-viewed document from the session with no reply needed", async () => {
    const capturedMessages: unknown[] = [];
    const deps = makeDeps({
      groq: {
        createChatCompletion: async (messages: unknown) => {
          capturedMessages.push(messages);
          return { text: "a summary", rateLimit: undefined };
        },
      },
    });
    const document: Document = {
      path: "ai-mastery/05-embeddings.md",
      name: "05-embeddings.md",
      content: "Full document content about embeddings in depth.",
    };
    const provider = createFakeContentProvider({
      getDocument: async () => document,
    });
    const sessionStore = createFakeSessionStore({
      1: { transcript: "", documentPath: "ai-mastery/05-embeddings.md" },
    });
    const { ctx } = createFakeBotContext({
      userId: 1,
      messageText: "summarize this",
    });

    await createAskHandler(deps, provider, sessionStore)(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("Full document content about embeddings");
  });

  it("drops a session document reference that's no longer visible to the user", async () => {
    const capturedMessages: unknown[] = [];
    const deps = makeDeps({
      groq: {
        createChatCompletion: async (messages: unknown) => {
          capturedMessages.push(messages);
          return { text: "an answer", rateLimit: undefined };
        },
      },
      privateFolders: [{ folder: "ai-mastery", ownerId: 999 }],
    });
    const provider = createFakeContentProvider({
      getDocument: async () => ({
        path: "ai-mastery/05-embeddings.md",
        name: "05-embeddings.md",
        content: "Should never be seen by user 1.",
      }),
    });
    const sessionStore = createFakeSessionStore({
      1: { transcript: "", documentPath: "ai-mastery/05-embeddings.md" },
    });
    const { ctx } = createFakeBotContext({
      userId: 1,
      messageText: "summarize this",
    });

    await createAskHandler(deps, provider, sessionStore)(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).not.toContain("Should never be seen by user 1");
  });

  it("replies with a safe message when the model call fails", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 1,
      messageText: "what are embeddings?",
    });
    const deps = makeDeps({
      groq: {
        createChatCompletion: async () => {
          throw new GroqUnavailableError();
        },
      },
    });

    await createAskHandler(
      deps,
      createFakeContentProvider(),
      createFakeSessionStore(),
    )(ctx);

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].text).toMatch(/couldn't get an answer/i);
  });
});
