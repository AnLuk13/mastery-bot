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

    await renderDirectory(ctx, provider, "", []);

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

    await renderDirectory(ctx, provider, "networking-mastery/protocols", []);

    expect(updateMessageCalls[0].text).toBe("📁 protocols");
  });

  it("appends the latest commit line under a folder's title when the provider supports it", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
      getLatestCommit: async () => ({
        message: "Add DNS caching section",
        date: "2026-08-20T10:00:00Z",
      }),
    });
    const { ctx, updateMessageCalls } = createFakeBotContext();

    await renderDirectory(ctx, provider, "networking-mastery", []);

    expect(updateMessageCalls[0].text).toBe(
      "📁 networking-mastery\n🕓 Add DNS caching section — 2026-08-20",
    );
  });

  it("omits the commit line entirely when the provider doesn't support commit history (e.g. local dev)", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
    });
    const { ctx, updateMessageCalls } = createFakeBotContext();

    await renderDirectory(ctx, provider, "networking-mastery", []);

    expect(updateMessageCalls[0].text).toBe("📁 networking-mastery");
  });

  it("omits the commit line rather than failing the whole render when fetching it throws", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
      getLatestCommit: async () => {
        throw new Error("network blip");
      },
    });
    const { ctx, updateMessageCalls } = createFakeBotContext();

    await renderDirectory(ctx, provider, "networking-mastery", []);

    expect(updateMessageCalls[0].text).toBe("📁 networking-mastery");
  });

  it("never fetches or shows a commit line for the root menu", async () => {
    let called = false;
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
      getLatestCommit: async () => {
        called = true;
        return { message: "should not be requested", date: "2026-08-20" };
      },
    });
    const { ctx, updateMessageCalls } = createFakeBotContext();

    await renderDirectory(ctx, provider, "", []);

    expect(called).toBe(false);
    expect(updateMessageCalls[0].text).toBe("📚 Mastery");
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

    await renderDirectory(ctx, provider, "networking-mastery", []);

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

    await renderDirectory(ctx, provider, "networking-mastery", []);

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

    await renderDirectory(ctx, provider, "networking-mastery", []);

    expect(callOrder).toEqual(["answerCallbackQuery", "listDirectory"]);
  });

  it("deletes the stale overflow messages when a cleanup hint is present, before showing the menu (Back/Home from a long document)", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
    });
    const { ctx, deleteMessagesCalls, updateMessageCalls } =
      createFakeBotContext();

    await renderDirectory(ctx, provider, "networking-mastery", [], {
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

    await renderDirectory(ctx, provider, "networking-mastery", []);

    expect(deleteMessagesCalls).toHaveLength(0);
  });

  it("shows the same 'not found' message (never a distinct 'forbidden') for a path private to another user", async () => {
    let called = false;
    const provider = createFakeContentProvider({
      listDirectory: async () => {
        called = true;
        return entries;
      },
    });
    const { ctx, updateMessageCalls } = createFakeBotContext({ userId: 999 });

    await renderDirectory(ctx, provider, "ai-mastery", [
      { folder: "ai-mastery", ownerId: 712059530 },
    ]);

    expect(called).toBe(false);
    expect(updateMessageCalls[0].text).toBe("📄 Not found.");
  });

  it("collapses root straight into a lone visible top-level folder's contents, keeping the root title and Search keyboard", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async (path) => {
        if (path === "") {
          return [{ type: "directory", name: "antonio", path: "antonio" }];
        }
        if (path === "antonio") {
          return [
            {
              type: "directory",
              name: "ai-mastery",
              path: "antonio/ai-mastery",
            },
            {
              type: "directory",
              name: "networking-mastery",
              path: "antonio/networking-mastery",
            },
          ];
        }
        throw new Error(`unexpected listDirectory(${path})`);
      },
    });
    const { ctx, updateMessageCalls } = createFakeBotContext({
      userId: 712059530,
    });

    await renderDirectory(ctx, provider, "", []);

    expect(updateMessageCalls[0].text).toBe("📚 Mastery");
    const rows = updateMessageCalls[0].keyboard?.inline_keyboard ?? [];
    expect(rows.flat()).toEqual([
      { text: "📁 ai-mastery", callback_data: "d:antonio/ai-mastery" },
      {
        text: "📁 networking-mastery",
        callback_data: "d:antonio/networking-mastery",
      },
      { text: "🔎 Search", callback_data: "s" },
    ]);
  });

  it("collapses through a chain of lone folders, not just one level", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async (path) => {
        if (path === "") {
          return [{ type: "directory", name: "a", path: "a" }];
        }
        if (path === "a") {
          return [{ type: "directory", name: "b", path: "a/b" }];
        }
        if (path === "a/b") {
          return [{ type: "document", name: "note.md", path: "a/b/note.md" }];
        }
        throw new Error(`unexpected listDirectory(${path})`);
      },
    });
    const { ctx, updateMessageCalls } = createFakeBotContext();

    await renderDirectory(ctx, provider, "", []);

    const rows = updateMessageCalls[0].keyboard?.inline_keyboard ?? [];
    expect(rows.flat()[0]).toEqual({
      text: "📄 note.md",
      callback_data: "f:a/b/note.md",
    });
  });

  it("does not collapse when root has more than one visible entry", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => entries,
    });
    const { ctx, updateMessageCalls } = createFakeBotContext();

    await renderDirectory(ctx, provider, "", []);

    const rows = updateMessageCalls[0].keyboard?.inline_keyboard ?? [];
    expect(rows.flat()).toContainEqual({
      text: "📁 networking-mastery",
      callback_data: "d:networking-mastery",
    });
  });

  it("does not collapse a lone entry that is itself a document, not a directory", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [
        { type: "document", name: "00-index.md", path: "00-index.md" },
      ],
    });
    const { ctx, updateMessageCalls } = createFakeBotContext();

    await renderDirectory(ctx, provider, "", []);

    const rows = updateMessageCalls[0].keyboard?.inline_keyboard ?? [];
    expect(rows.flat()[0]).toEqual({
      text: "📄 00-index.md",
      callback_data: "f:00-index.md",
    });
  });

  it("filters entries in a folder private to another user out of a listing", async () => {
    const mixedEntries: ContentEntry[] = [
      { type: "directory", name: "ai-mastery", path: "ai-mastery" },
      { type: "directory", name: "andreea", path: "andreea" },
    ];
    const provider = createFakeContentProvider({
      listDirectory: async () => mixedEntries,
    });
    const { ctx, updateMessageCalls } = createFakeBotContext({ userId: 999 });

    await renderDirectory(ctx, provider, "", [
      { folder: "ai-mastery", ownerId: 712059530 },
    ]);

    const buttons = (
      updateMessageCalls[0].keyboard?.inline_keyboard ?? []
    ).flat();
    expect(buttons.map((b) => b.text)).toEqual(["📁 andreea", "🔎 Search"]);
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

    await createDirectoryCallbackHandler(provider, [])(
      ctx,
      "networking-mastery",
    );

    expect(updateMessageCalls[0].text).toBe("📁 networking-mastery");
  });

  it("passes a cleanup hint through to renderDirectory", async () => {
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
    });
    const { ctx, deleteMessagesCalls } = createFakeBotContext();

    await createDirectoryCallbackHandler(provider, [])(
      ctx,
      "networking-mastery",
      {
        firstMessageId: 7,
        count: 1,
      },
    );

    expect(deleteMessagesCalls).toEqual([{ fromMessageId: 7, count: 1 }]);
  });
});
