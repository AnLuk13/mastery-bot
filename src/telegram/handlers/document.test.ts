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

  it("shows an alert without touching the current message when the document is missing", async () => {
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

    expect(updateMessageCalls).toHaveLength(0);
    expect(sendMessageCalls).toHaveLength(0);
    expect(answerCallbackQueryCalls).toEqual([
      { text: "📄 Not found.", showAlert: true },
    ]);
  });

  it("shows a generic alert (never the raw error) when the provider fails", async () => {
    const provider = createFakeContentProvider({
      getDocument: async () => {
        throw new ContentProviderUnavailableError(
          "GitHub is down for maintenance, secret detail",
        );
      },
    });
    const { ctx, answerCallbackQueryCalls } = createFakeBotContext();

    await createDocumentCallbackHandler(provider)(ctx, "x.md");

    expect(answerCallbackQueryCalls[0].showAlert).toBe(true);
    expect(answerCallbackQueryCalls[0].text).not.toContain("GitHub is down");
  });
});
