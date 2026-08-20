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
});
