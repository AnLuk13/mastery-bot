import { describe, expect, it } from "vitest";
import {
  createFakeAllowedUsersStore,
  createFakeBotContext,
} from "../testHelpers";
import {
  createAdminAddPromptHandler,
  createAdminAddUserHandler,
  createAdminHandler,
  createAdminRemoveHandler,
  isAdminAddUserContinuation,
  type AdminDeps,
} from "./admin";

const ADMIN_ID = 712059530;
const NON_ADMIN_ID = 999;

function baseDeps(overrides: Partial<AdminDeps> = {}): AdminDeps {
  return {
    adminIds: overrides.adminIds ?? [ADMIN_ID],
    baseAllowedUserIds: overrides.baseAllowedUserIds ?? [ADMIN_ID, 111],
    allowedUsersStore:
      overrides.allowedUsersStore ?? createFakeAllowedUsersStore(),
  };
}

describe("createAdminHandler", () => {
  it("denies a non-admin", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: NON_ADMIN_ID,
    });
    await createAdminHandler(baseDeps())(ctx);
    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("lists base and dynamic users with a remove button per dynamic user", async () => {
    const allowedUsersStore = createFakeAllowedUsersStore([555]);
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: ADMIN_ID,
    });
    await createAdminHandler(baseDeps({ allowedUsersStore }))(ctx);

    expect(sendMessageCalls[0].text).toContain(String(ADMIN_ID));
    expect(sendMessageCalls[0].text).toContain("555");
    expect(sendMessageCalls[0].keyboard?.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({ text: "❌ Remove 555" }),
    );
  });
});

describe("createAdminAddPromptHandler", () => {
  it("denies a non-admin", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: NON_ADMIN_ID,
      callbackData: "aa",
    });
    await createAdminAddPromptHandler(baseDeps())(ctx);
    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("prompts for a reply", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: ADMIN_ID,
      callbackData: "aa",
    });
    await createAdminAddPromptHandler(baseDeps())(ctx);
    expect(sendMessageCalls[0].text).toMatch(/reply to this message/i);
  });
});

describe("isAdminAddUserContinuation", () => {
  it("recognizes a reply to the add-user prompt", async () => {
    const { ctx: promptCtx, sendMessageCalls } = createFakeBotContext({
      userId: ADMIN_ID,
      callbackData: "aa",
    });
    await createAdminAddPromptHandler(baseDeps())(promptCtx);
    const promptText = sendMessageCalls[0].text;

    const { ctx: replyCtx } = createFakeBotContext({
      userId: ADMIN_ID,
      replyToMessageText: promptText,
      messageText: "123",
    });
    expect(isAdminAddUserContinuation(replyCtx)).toBe(true);
  });

  it("is false for an unrelated reply", () => {
    const { ctx } = createFakeBotContext({
      userId: ADMIN_ID,
      replyToMessageText: "just some other message",
    });
    expect(isAdminAddUserContinuation(ctx)).toBe(false);
  });
});

describe("createAdminAddUserHandler", () => {
  it("denies a non-admin", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: NON_ADMIN_ID,
      messageText: "123",
    });
    await createAdminAddUserHandler(baseDeps())(ctx);
    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("rejects a non-numeric reply", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: ADMIN_ID,
      messageText: "not a number",
    });
    await createAdminAddUserHandler(baseDeps())(ctx);
    expect(sendMessageCalls[0].text).toMatch(/numeric/i);
  });

  it("adds a valid user id and confirms", async () => {
    const allowedUsersStore = createFakeAllowedUsersStore();
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: ADMIN_ID,
      messageText: "555",
    });
    await createAdminAddUserHandler(baseDeps({ allowedUsersStore }))(ctx);

    expect(await allowedUsersStore.list()).toEqual([555]);
    expect(sendMessageCalls[0].text).toContain("555");
  });
});

describe("createAdminRemoveHandler", () => {
  it("denies a non-admin", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: NON_ADMIN_ID,
      callbackData: "ar:555",
    });
    await createAdminRemoveHandler(baseDeps())(ctx, 555);
    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("removes a dynamic user id and confirms", async () => {
    const allowedUsersStore = createFakeAllowedUsersStore([555]);
    const { ctx, updateMessageCalls } = createFakeBotContext({
      userId: ADMIN_ID,
      callbackData: "ar:555",
    });
    await createAdminRemoveHandler(baseDeps({ allowedUsersStore }))(ctx, 555);

    expect(await allowedUsersStore.list()).toEqual([]);
    expect(updateMessageCalls[0].text).toContain("555");
  });
});
