import { describe, expect, it } from "vitest";
import { createFakeBotContext } from "./testHelpers";
import { enforceAuthorization, isAuthorizedUser } from "./auth";

describe("isAuthorizedUser", () => {
  it("allows a user id present in the allow-list", () => {
    expect(isAuthorizedUser(123, [123, 456])).toBe(true);
  });

  it("denies a user id absent from the allow-list", () => {
    expect(isAuthorizedUser(999, [123, 456])).toBe(false);
  });

  it("denies an undefined user id", () => {
    expect(isAuthorizedUser(undefined, [123])).toBe(false);
  });

  it("denies everyone when the allow-list is empty", () => {
    expect(isAuthorizedUser(123, [])).toBe(false);
  });
});

describe("enforceAuthorization", () => {
  it("allows an authorized user through without sending anything", async () => {
    const { ctx, sendMessageCalls, answerCallbackQueryCalls } =
      createFakeBotContext({ userId: 123 });

    expect(await enforceAuthorization(ctx, [123])).toBe(true);
    expect(sendMessageCalls).toHaveLength(0);
    expect(answerCallbackQueryCalls).toHaveLength(0);
  });

  it("sends a generic denial message for an unauthorized command (no callback data)", async () => {
    const { ctx, sendMessageCalls, answerCallbackQueryCalls } =
      createFakeBotContext({ userId: 999 });

    expect(await enforceAuthorization(ctx, [123])).toBe(false);
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].text).not.toContain("undefined");
    expect(answerCallbackQueryCalls).toHaveLength(0);
  });

  it("answers with a generic denial alert for an unauthorized callback", async () => {
    const { ctx, sendMessageCalls, answerCallbackQueryCalls } =
      createFakeBotContext({
        userId: 999,
        callbackData: "d:networking-mastery",
      });

    expect(await enforceAuthorization(ctx, [123])).toBe(false);
    expect(sendMessageCalls).toHaveLength(0);
    expect(answerCallbackQueryCalls).toEqual([
      { text: expect.any(String), showAlert: true },
    ]);
  });

  it("denies an undefined user id", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext();

    expect(await enforceAuthorization(ctx, [123])).toBe(false);
    expect(sendMessageCalls).toHaveLength(1);
  });
});
