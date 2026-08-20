import { describe, expect, it } from "vitest";
import { ContentProviderUnavailableError, type SearchResult } from "@/content";
import { enforceAuthorization } from "../auth";
import {
  createFakeBotContext,
  createFakeContentProvider,
} from "../testHelpers";
import { createSearchCommandHandler, handleSearchHelpCallback } from "./search";

describe("createSearchCommandHandler", () => {
  it("shows usage and never calls the provider for an empty query", async () => {
    let called = false;
    const provider = createFakeContentProvider({
      search: async () => {
        called = true;
        return [];
      },
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({ commandArgs: "" });

    await createSearchCommandHandler(provider, [])(ctx);

    expect(called).toBe(false);
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].text).toContain("/search");
  });

  it("shows usage and never calls the provider for a whitespace-only query", async () => {
    let called = false;
    const provider = createFakeContentProvider({
      search: async () => {
        called = true;
        return [];
      },
    });
    const { ctx } = createFakeBotContext({ commandArgs: "   " });

    await createSearchCommandHandler(provider, [])(ctx);

    expect(called).toBe(false);
  });

  it("passes the query through to ContentProvider.search verbatim (Telegram does not implement search itself)", async () => {
    let receivedQuery: string | undefined;
    const provider = createFakeContentProvider({
      search: async (query) => {
        receivedQuery = query;
        return [];
      },
    });
    const { ctx } = createFakeBotContext({ commandArgs: "  TCP Handshake  " });

    await createSearchCommandHandler(provider, [])(ctx);

    expect(receivedQuery).toBe("TCP Handshake");
  });

  it("shows a 'no results' message when the provider finds nothing", async () => {
    const provider = createFakeContentProvider({ search: async () => [] });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      commandArgs: "zzz-nonexistent",
    });

    await createSearchCommandHandler(provider, [])(ctx);

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].text).toContain("No results found");
    expect(sendMessageCalls[0].keyboard).toBeUndefined();
  });

  it("renders a filename match result as an openable button", async () => {
    const results: SearchResult[] = [
      { path: "00-index.md", name: "00-index.md", matchType: "filename" },
    ];
    const provider = createFakeContentProvider({ search: async () => results });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      commandArgs: "index",
    });

    await createSearchCommandHandler(provider, [])(ctx);

    expect(sendMessageCalls[0].keyboard?.inline_keyboard[0][0]).toEqual({
      text: "📄 00-index.md",
      callback_data: "f:00-index.md",
    });
  });

  it("renders a path match result as an openable button", async () => {
    const results: SearchResult[] = [
      { path: "networking-mastery/tcp.md", name: "tcp.md", matchType: "path" },
    ];
    const provider = createFakeContentProvider({ search: async () => results });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      commandArgs: "networking-mastery",
    });

    await createSearchCommandHandler(provider, [])(ctx);

    expect(sendMessageCalls[0].keyboard?.inline_keyboard[0][0]).toMatchObject({
      callback_data: "f:networking-mastery/tcp.md",
    });
  });

  it("renders a content match result with all others when there are multiple results", async () => {
    const results: SearchResult[] = [
      {
        path: "networking-mastery/01-tcp.md",
        name: "01-tcp.md",
        matchType: "content",
        snippet: "…TCP…",
      },
      {
        path: "networking-mastery/protocols/deep.md",
        name: "deep.md",
        matchType: "content",
      },
    ];
    const provider = createFakeContentProvider({ search: async () => results });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      commandArgs: "tcp",
    });

    await createSearchCommandHandler(provider, [])(ctx);

    const rows = sendMessageCalls[0].keyboard?.inline_keyboard ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toMatchObject({
      callback_data: "f:networking-mastery/01-tcp.md",
    });
    expect(rows[1][0]).toMatchObject({
      callback_data: "f:networking-mastery/protocols/deep.md",
    });
    expect(sendMessageCalls[0].text).toBe("🔎 Search: tcp");
  });

  it("shows a generic message (never the raw error) when the provider fails", async () => {
    const provider = createFakeContentProvider({
      search: async () => {
        throw new ContentProviderUnavailableError(
          "internal GitHub rate-limit detail",
        );
      },
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      commandArgs: "tcp",
    });

    await createSearchCommandHandler(provider, [])(ctx);

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].text).not.toContain("rate-limit");
  });

  it("filters out results in a folder private to another user", async () => {
    const results: SearchResult[] = [
      {
        path: "ai-mastery/01-intro.md",
        name: "01-intro.md",
        matchType: "filename",
      },
      {
        path: "networking-mastery/01-tcp.md",
        name: "01-tcp.md",
        matchType: "filename",
      },
    ];
    const provider = createFakeContentProvider({ search: async () => results });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 999,
      commandArgs: "tcp",
    });

    await createSearchCommandHandler(provider, [
      { folder: "ai-mastery", ownerId: 712059530 },
    ])(ctx);

    const rows = sendMessageCalls[0].keyboard?.inline_keyboard ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toMatchObject({
      callback_data: "f:networking-mastery/01-tcp.md",
    });
  });

  it("never reaches the provider for an unauthorized user (gated by the shared auth check)", async () => {
    let called = false;
    const provider = createFakeContentProvider({
      search: async () => {
        called = true;
        return [];
      },
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 999,
      commandArgs: "tcp",
    });

    const authorized = await enforceAuthorization(ctx, [123]);
    if (authorized) await createSearchCommandHandler(provider, [])(ctx);

    expect(authorized).toBe(false);
    expect(called).toBe(false);
    expect(sendMessageCalls).toEqual([
      { text: expect.any(String), keyboard: undefined, parseMode: undefined },
    ]);
    expect(sendMessageCalls[0].text).not.toContain("Search:");
  });
});

describe("handleSearchHelpCallback", () => {
  it("answers with usage instructions instead of performing a search", async () => {
    const { ctx, answerCallbackQueryCalls } = createFakeBotContext({
      callbackData: "s",
    });

    await handleSearchHelpCallback(ctx);

    expect(answerCallbackQueryCalls).toHaveLength(1);
    expect(answerCallbackQueryCalls[0].text).toContain("/search");
    expect(answerCallbackQueryCalls[0].showAlert).toBe(true);
  });
});
