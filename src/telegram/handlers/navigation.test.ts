import { describe, expect, it } from "vitest";
import { ContentProviderUnavailableError, type ContentEntry } from "@/content";
import {
  createFakeBotContext,
  createFakeContentProvider,
} from "../testHelpers";
import { createDirectoryCallbackHandler, renderDirectory } from "./navigation";

const entries: ContentEntry[] = [
  { type: "directory", name: "networking-mastery", path: "networking-mastery" },
  { type: "document", name: "00-index.md", path: "00-index.md" },
];

describe("renderDirectory", () => {
  it("renders the root menu with the Mastery title", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => entries,
    });
    const { ctx, updateMessageCalls, answerCallbackQueryCalls } =
      createFakeBotContext();

    await renderDirectory(ctx, provider, "");

    expect(updateMessageCalls).toHaveLength(1);
    expect(updateMessageCalls[0].text).toBe("📚 Mastery");
    expect(updateMessageCalls[0].keyboard?.inline_keyboard[0][0]).toEqual({
      text: "📁 networking-mastery",
      callback_data: "d:networking-mastery",
    });
    expect(answerCallbackQueryCalls).toHaveLength(1);
  });

  it("renders a nested folder using its leaf name as the title", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
    });
    const { ctx, updateMessageCalls } = createFakeBotContext();

    await renderDirectory(ctx, provider, "networking-mastery/protocols");

    expect(updateMessageCalls[0].text).toBe("📁 protocols");
  });

  it("requests exactly the requested path from the provider, not the whole tree", async () => {
    let requestedPath: string | undefined;
    const provider = createFakeContentProvider({
      listDirectory: async (path) => {
        requestedPath = path;
        return [];
      },
    });
    const { ctx } = createFakeBotContext();

    await renderDirectory(ctx, provider, "networking-mastery");

    expect(requestedPath).toBe("networking-mastery");
  });

  it("shows a friendly message and Home button when the provider fails", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => {
        throw new ContentProviderUnavailableError("boom");
      },
    });
    const { ctx, updateMessageCalls, answerCallbackQueryCalls } =
      createFakeBotContext();

    await renderDirectory(ctx, provider, "networking-mastery");

    expect(updateMessageCalls).toHaveLength(1);
    expect(updateMessageCalls[0].text).not.toContain("boom");
    expect(updateMessageCalls[0].keyboard?.inline_keyboard[0][0]).toEqual({
      text: "🏠 Home",
      callback_data: "d:",
    });
    expect(answerCallbackQueryCalls).toHaveLength(1);
  });

  it("acknowledges the callback immediately, before fetching from the provider (avoids Telegram's callback-expiry error)", async () => {
    const callOrder: string[] = [];
    const provider = createFakeContentProvider({
      listDirectory: async () => {
        callOrder.push("listDirectory");
        return entries;
      },
    });
    const { ctx } = createFakeBotContext();
    const originalAnswer = ctx.answerCallbackQuery.bind(ctx);
    ctx.answerCallbackQuery = async (...args) => {
      callOrder.push("answerCallbackQuery");
      await originalAnswer(...args);
    };

    await renderDirectory(ctx, provider, "networking-mastery");

    expect(callOrder).toEqual(["answerCallbackQuery", "listDirectory"]);
  });

  it("deletes the stale overflow messages when a cleanup hint is present, before showing the menu (Back/Home from a long document)", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
    });
    const { ctx, deleteMessagesCalls, updateMessageCalls } =
      createFakeBotContext();

    await renderDirectory(ctx, provider, "networking-mastery", {
      firstMessageId: 100,
      count: 3,
    });

    expect(deleteMessagesCalls).toEqual([{ fromMessageId: 100, count: 3 }]);
    expect(updateMessageCalls).toHaveLength(1); // still shows exactly one menu message, nothing left stacked
  });

  it("does not attempt any cleanup when no hint is given (the normal case)", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
    });
    const { ctx, deleteMessagesCalls } = createFakeBotContext();

    await renderDirectory(ctx, provider, "networking-mastery");

    expect(deleteMessagesCalls).toHaveLength(0);
  });
});

describe("createDirectoryCallbackHandler", () => {
  it("delegates to renderDirectory for the decoded path", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => entries,
    });
    const { ctx, updateMessageCalls } = createFakeBotContext({
      callbackData: "d:networking-mastery",
    });

    await createDirectoryCallbackHandler(provider)(ctx, "networking-mastery");

    expect(updateMessageCalls[0].text).toBe("📁 networking-mastery");
  });

  it("passes a cleanup hint through to renderDirectory", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
    });
    const { ctx, deleteMessagesCalls } = createFakeBotContext();

    await createDirectoryCallbackHandler(provider)(ctx, "networking-mastery", {
      firstMessageId: 7,
      count: 1,
    });

    expect(deleteMessagesCalls).toEqual([{ fromMessageId: 7, count: 1 }]);
  });
});
