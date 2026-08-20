import type { EditorConfig } from "@/lib/env";
import type { BotContext } from "./types";
import { ACCESS_DENIED_MESSAGE } from "./userMessages";

export function isAuthorizedUser(
  userId: number | undefined,
  allowedUserIds: readonly number[],
): boolean {
  return userId !== undefined && allowedUserIds.includes(userId);
}

/** The folder this user's /save writes are confined to, or undefined if they're not an editor. */
export function findEditorFolder(
  userId: number | undefined,
  editors: readonly EditorConfig[],
): string | undefined {
  if (userId === undefined) return undefined;
  return editors.find((editor) => editor.userId === userId)?.folder;
}

/**
 * Single authorization gate for every update, command or callback alike.
 * Returns true (and sends nothing) when authorized; otherwise sends a
 * generic denial — an alert for callbacks, a message for commands — and
 * returns false so the caller skips dispatching to any handler.
 */
export async function enforceAuthorization(
  ctx: BotContext,
  allowedUserIds: readonly number[],
): Promise<boolean> {
  if (isAuthorizedUser(ctx.userId, allowedUserIds)) return true;

  if (ctx.callbackData !== undefined) {
    await ctx.answerCallbackQuery(ACCESS_DENIED_MESSAGE, true);
  } else {
    await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
  }
  return false;
}
