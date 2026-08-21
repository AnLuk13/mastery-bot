import {
  ContentNotFoundError,
  isPathVisible,
  type ContentProvider,
  type Document,
  type PrivateFolderConfig,
} from "@/content";
import type { SessionStore } from "@/session";
import type { CleanupHint } from "../callbackData";
import { buildDocumentKeyboard } from "../keyboards/navigation";
import { renderDocumentMessages } from "../formatting";
import type { BotContext } from "../types";
import { describeContentError } from "../userMessages";

export function createDocumentCallbackHandler(
  provider: ContentProvider,
  privateFolders: readonly PrivateFolderConfig[],
  sessionStore: SessionStore,
) {
  return async (ctx: BotContext, canonicalPath: string): Promise<void> => {
    // Acknowledge before doing any slow work (GitHub fetch, message send/edit): Telegram
    // expires a callback query after a short window, and answering late causes it to
    // retry-deliver the update, compounding the delay.
    await ctx.answerCallbackQuery();

    let document: Document;
    try {
      // Same "not found" a genuinely missing path gets — never reveal that a
      // private path exists to someone who isn't its owner.
      if (!isPathVisible(canonicalPath, ctx.userId, privateFolders)) {
        throw new ContentNotFoundError(canonicalPath);
      }
      document = await provider.getDocument(canonicalPath);
    } catch (error) {
      await ctx.updateMessage(
        describeContentError(error),
        buildDocumentKeyboard(canonicalPath),
      );
      return;
    }

    // Remembered as this chat's "last viewed" document so a plain follow-up
    // question (no reply needed) can be answered against it — see ask.ts.
    if (ctx.userId !== undefined) {
      const session = await sessionStore.get(ctx.userId);
      await sessionStore.set(ctx.userId, {
        ...session,
        documentPath: canonicalPath,
      });
    }

    const messages = renderDocumentMessages(document);
    const lastIndex = messages.length - 1;

    // A document that overflows one Telegram message edits the current message
    // for chunk 0, then sends the rest as new messages — leaving `lastIndex`
    // extra messages behind. Back/Home need to know about them so they can be
    // deleted instead of piling up under the menu (see callbackData.ts).
    const cleanup: CleanupHint | undefined =
      lastIndex > 0 && ctx.messageId !== undefined
        ? { firstMessageId: ctx.messageId, count: lastIndex }
        : undefined;
    const keyboard = buildDocumentKeyboard(canonicalPath, cleanup);

    for (let i = 0; i < messages.length; i++) {
      const isLast = i === lastIndex;
      const { text, parseMode } = messages[i];
      if (i === 0) {
        await ctx.updateMessage(text, isLast ? keyboard : undefined, parseMode);
      } else {
        await ctx.sendMessage(text, isLast ? keyboard : undefined, parseMode);
      }
    }
  };
}
