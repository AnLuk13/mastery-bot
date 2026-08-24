import type { AllowedUsersStore } from "@/admin";
import { buildAdminKeyboard } from "../keyboards/admin";
import type { BotContext } from "../types";
import {
  ACCESS_DENIED_MESSAGE,
  ADMIN_INVALID_USER_ID_MESSAGE,
  describeAdminError,
  formatAdminAddPrompt,
  formatAdminList,
  formatAdminUserAdded,
  formatAdminUserRemoved,
  isAdminAddContinuation,
} from "../userMessages";

export interface AdminDeps {
  adminIds: readonly number[];
  baseAllowedUserIds: readonly number[];
  allowedUsersStore: AllowedUsersStore;
}

function isAdmin(
  userId: number | undefined,
  adminIds: readonly number[],
): boolean {
  return userId !== undefined && adminIds.includes(userId);
}

/** True when this incoming plain-text message is a reply continuing a prior /admin add-user prompt. */
export function isAdminAddUserContinuation(ctx: BotContext): boolean {
  return isAdminAddContinuation(ctx.replyToMessageText);
}

export function createAdminHandler(deps: AdminDeps) {
  return async (ctx: BotContext): Promise<void> => {
    if (!isAdmin(ctx.userId, deps.adminIds)) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    try {
      const dynamicIds = await deps.allowedUsersStore.list();
      await ctx.sendMessage(
        formatAdminList(deps.baseAllowedUserIds, dynamicIds),
        buildAdminKeyboard(dynamicIds),
      );
    } catch (error) {
      await ctx.sendMessage(describeAdminError(error));
    }
  };
}

/** Handles a tap on /admin's "➕ Add user" button — just prompts for a reply, since the actual id has to come from the admin. */
export function createAdminAddPromptHandler(deps: AdminDeps) {
  return async (ctx: BotContext): Promise<void> => {
    await ctx.answerCallbackQuery();

    if (!isAdmin(ctx.userId, deps.adminIds)) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    await ctx.sendMessage(formatAdminAddPrompt());
  };
}

/** Handles the admin's reply to the add-user prompt (see isAdminAddUserContinuation). */
export function createAdminAddUserHandler(deps: AdminDeps) {
  return async (ctx: BotContext): Promise<void> => {
    if (!isAdmin(ctx.userId, deps.adminIds)) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    const raw = (ctx.messageText ?? "").trim();
    const userId = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(userId)) {
      await ctx.sendMessage(ADMIN_INVALID_USER_ID_MESSAGE);
      return;
    }

    try {
      await deps.allowedUsersStore.add(userId);
      await ctx.sendMessage(formatAdminUserAdded(userId));
    } catch (error) {
      await ctx.sendMessage(describeAdminError(error));
    }
  };
}

/** Handles a tap on one of /admin's "❌ Remove <id>" buttons. */
export function createAdminRemoveHandler(deps: AdminDeps) {
  return async (ctx: BotContext, userId: number): Promise<void> => {
    await ctx.answerCallbackQuery();

    if (!isAdmin(ctx.userId, deps.adminIds)) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    try {
      await deps.allowedUsersStore.remove(userId);
      await ctx.updateMessage(formatAdminUserRemoved(userId));
    } catch (error) {
      await ctx.sendMessage(describeAdminError(error));
    }
  };
}
