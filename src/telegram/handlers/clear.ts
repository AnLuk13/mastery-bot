import type { ContentProvider, PrivateFolderConfig } from "@/content";
import type { SessionStore } from "@/session";
import type { BotContext } from "../types";
import { renderDirectory } from "./navigation";

/**
 * How far back /clear reaches. The bot is stateless and Telegram gives bots
 * no way to list a chat's history, so there's no way to know exactly how many
 * messages belong to "this session" — this trades a hard guarantee for a
 * generous, bounded sweep of recent messages (same best-effort philosophy as
 * deleteMessages itself: a message that's already gone, or older than
 * Telegram's 48h bot-delete window, just silently fails to delete).
 */
const CLEAR_LOOKBACK_MESSAGES = 60;

/** Deletes recent chat clutter (your typed questions and the bot's replies), wipes ambient /ask session memory, and shows just the menu. */
export function createClearHandler(
  provider: ContentProvider,
  privateFolders: readonly PrivateFolderConfig[],
  sessionStore: SessionStore,
) {
  return async (ctx: BotContext): Promise<void> => {
    if (ctx.messageId !== undefined) {
      const fromMessageId = Math.max(
        1,
        ctx.messageId - CLEAR_LOOKBACK_MESSAGES + 1,
      );
      await ctx.deleteMessages(
        fromMessageId,
        ctx.messageId - fromMessageId + 1,
      );
    }
    if (ctx.userId !== undefined) {
      await sessionStore.clear(ctx.userId);
    }
    await renderDirectory(ctx, provider, "", privateFolders);
  };
}
