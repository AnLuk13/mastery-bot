import { describe, expect, it } from "vitest";
import {
  createFakeBotContext,
  createFakeContentProvider,
} from "../testHelpers";
import { createClearHandler } from "./clear";

describe("createClearHandler", () => {
  it("deletes a bounded run of recent messages ending at the command itself, then shows the menu", async () => {
    const { ctx, deleteMessagesCalls, updateMessageCalls } =
      createFakeBotContext({
        messageId: 5100,
      });
    const provider = createFakeContentProvider({
      listDirectory: async () => [],
    });

    await createClearHandler(provider, [])(ctx);

    expect(deleteMessagesCalls).toHaveLength(1);
    expect(deleteMessagesCalls[0]).toEqual({ fromMessageId: 5041, count: 60 });
    expect(updateMessageCalls).toHaveLength(1);
  });

  it("clamps the delete range so it never goes below message id 1", async () => {
    const { ctx, deleteMessagesCalls } = createFakeBotContext({
      messageId: 10,
    });
    const provider = createFakeContentProvider();

    await createClearHandler(provider, [])(ctx);

    expect(deleteMessagesCalls[0]).toEqual({ fromMessageId: 1, count: 10 });
  });

  it("skips deletion (but still shows the menu) when there's no known message id", async () => {
    const { ctx, deleteMessagesCalls, updateMessageCalls } =
      createFakeBotContext();
    const provider = createFakeContentProvider();

    await createClearHandler(provider, [])(ctx);

    expect(deleteMessagesCalls).toHaveLength(0);
    expect(updateMessageCalls).toHaveLength(1);
  });
});
