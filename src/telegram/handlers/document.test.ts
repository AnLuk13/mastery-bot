import { describe, expect, it } from "vitest";
import {
  ContentNotFoundError,
  ContentProviderUnavailableError,
  type Document,
} from "@/content";
import {
  createFakeBotContext,
  createFakeContentProvider,
} from "../testHelpers";
import { createDocumentCallbackHandler } from "./document";

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    path: "networking-mastery/01-tcp.md",
    name: "01-tcp.md",
    content: "# TCP\nShort body.",
    ...overrides,
  };
}

describe("createDocumentCallbackHandler", () => {
  it("opens a short document as a single edited message with the document keyboard", async () => {
    const provider = createFakeContentProvider({
      getDocument: async () => makeDocument(),
    });
    const {
      ctx,
      updateMessageCalls,
      sendMessageCalls,
      answerCallbackQueryCalls,
    } = createFakeBotContext({
      callbackData: "f:networking-mastery/01-tcp.md",
    });

    await createDocumentCallbackHandler(provider)(
      ctx,
      "networking-mastery/01-tcp.md",
    );

    expect(updateMessageCalls).toHaveLength(1);
    expect(updateMessageCalls[0].text).toBe("<b>TCP</b>\n\nShort body.");
    expect(updateMessageCalls[0].parseMode).toBe("HTML");
    expect(updateMessageCalls[0].keyboard?.inline_keyboard[0]).toEqual([
      { text: "⬅️ Back", callback_data: "d:networking-mastery" },
      { text: "🏠 Home", callback_data: "d:" },
    ]);
    expect(sendMessageCalls).toHaveLength(0);
    expect(answerCallbackQueryCalls).toEqual([
      { text: undefined, showAlert: undefined },
    ]);
  });

  it("requests exactly the requested document path from the provider", async () => {
    let requestedPath: string | undefined;
    const provider = createFakeContentProvider({
      getDocument: async (path) => {
        requestedPath = path;
        return makeDocument({ path });
      },
    });
    const { ctx } = createFakeBotContext();

    await createDocumentCallbackHandler(provider)(
      ctx,
      "networking-mastery/01-tcp.md",
    );

    expect(requestedPath).toBe("networking-mastery/01-tcp.md");
  });

  it("splits a long document across multiple messages, attaching the keyboard only to the last one", async () => {
    const longContent = "word ".repeat(2000);
    const provider = createFakeContentProvider({
      getDocument: async () => makeDocument({ content: longContent }),
    });
    const { ctx, updateMessageCalls, sendMessageCalls } =
      createFakeBotContext();

    await createDocumentCallbackHandler(provider)(ctx, "big.md");

    expect(updateMessageCalls).toHaveLength(1);
    expect(updateMessageCalls[0].keyboard).toBeUndefined();
    expect(sendMessageCalls.length).toBeGreaterThan(0);
    expect(
      sendMessageCalls
        .slice(0, -1)
        .every((call) => call.keyboard === undefined),
    ).toBe(true);
    expect(sendMessageCalls.at(-1)?.keyboard).toBeDefined();
  });

  it("attaches a cleanup hint (starting at the current message) to the last message's Back/Home when the document overflowed", async () => {
    const longContent = "word ".repeat(2000);
    const provider = createFakeContentProvider({
      getDocument: async () => makeDocument({ content: longContent }),
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({ messageId: 500 });

    await createDocumentCallbackHandler(provider)(ctx, "big.md");

    const lastKeyboard = sendMessageCalls.at(-1)?.keyboard;
    const backButton = lastKeyboard?.inline_keyboard[0][0];
    // 3 messages total (1 edited + 2 sent) means 2 extra messages to clean up, starting at the edited message's id.
    expect(backButton).toMatchObject({
      callback_data: expect.stringContaining("%500+2"),
    });
  });

  it("attaches no cleanup hint when the document fits in a single message, even with a known messageId", async () => {
    const provider = createFakeContentProvider({
      getDocument: async () => makeDocument(),
    });
    const { ctx, updateMessageCalls } = createFakeBotContext({
      messageId: 500,
    });

    await createDocumentCallbackHandler(provider)(
      ctx,
      "networking-mastery/01-tcp.md",
    );

    const backButton = updateMessageCalls[0].keyboard?.inline_keyboard[0][0];
    expect(backButton).toEqual({
      text: "⬅️ Back",
      callback_data: "d:networking-mastery",
    });
  });

  it("attaches no cleanup hint when messageId is unknown, even for an overflowing document", async () => {
    const longContent = "word ".repeat(2000);
    const provider = createFakeContentProvider({
      getDocument: async () => makeDocument({ content: longContent }),
    });
    const { ctx, sendMessageCalls } = createFakeBotContext(); // no messageId

    await createDocumentCallbackHandler(provider)(ctx, "big.md");

    const backButton = sendMessageCalls.at(-1)?.keyboard?.inline_keyboard[0][0];
    expect(backButton).toMatchObject({
      callback_data: expect.not.stringContaining("%"),
    });
  });

  it("acknowledges the callback immediately, before any slow work, regardless of outcome", async () => {
    const callOrder: string[] = [];
    const provider = createFakeContentProvider({
      getDocument: async () => {
        callOrder.push("getDocument");
        return makeDocument();
      },
    });
    const { ctx } = createFakeBotContext();
    const originalAnswer = ctx.answerCallbackQuery.bind(ctx);
    ctx.answerCallbackQuery = async (...args) => {
      callOrder.push("answerCallbackQuery");
      await originalAnswer(...args);
    };

    await createDocumentCallbackHandler(provider)(ctx, "x.md");

    expect(callOrder).toEqual(["answerCallbackQuery", "getDocument"]);
  });

  it("shows a friendly message (via the document keyboard) when the document is missing, without leaking the raw error", async () => {
    const provider = createFakeContentProvider({
      getDocument: async (path) => {
        throw new ContentNotFoundError(path);
      },
    });
    const {
      ctx,
      updateMessageCalls,
      sendMessageCalls,
      answerCallbackQueryCalls,
    } = createFakeBotContext();

    await createDocumentCallbackHandler(provider)(ctx, "missing.md");

    expect(answerCallbackQueryCalls).toEqual([
      { text: undefined, showAlert: undefined },
    ]);
    expect(sendMessageCalls).toHaveLength(0);
    expect(updateMessageCalls).toHaveLength(1);
    expect(updateMessageCalls[0].text).toBe("📄 Not found.");
    expect(updateMessageCalls[0].keyboard?.inline_keyboard[0]).toEqual([
      { text: "⬅️ Back", callback_data: "d:" },
      { text: "🏠 Home", callback_data: "d:" },
    ]);
  });

  it("shows a generic message (never the raw error) when the provider fails", async () => {
    const provider = createFakeContentProvider({
      getDocument: async () => {
        throw new ContentProviderUnavailableError(
          "GitHub is down for maintenance, secret detail",
        );
      },
    });
    const { ctx, updateMessageCalls } = createFakeBotContext();

    await createDocumentCallbackHandler(provider)(ctx, "x.md");

    expect(updateMessageCalls).toHaveLength(1);
    expect(updateMessageCalls[0].text).not.toContain("GitHub is down");
  });
});
