import type { ContentProvider, Document } from "@/content";
import { buildDocumentKeyboard } from "../keyboards/navigation";
import { renderDocumentMessages } from "../formatting";
import type { BotContext } from "../types";
import { describeContentError } from "../userMessages";

export function createDocumentCallbackHandler(provider: ContentProvider) {
  return async (ctx: BotContext, canonicalPath: string): Promise<void> => {
    let document: Document;
    try {
      document = await provider.getDocument(canonicalPath);
    } catch (error) {
      await ctx.answerCallbackQuery(describeContentError(error), true);
      return;
    }

    const messages = renderDocumentMessages(document);
    const keyboard = buildDocumentKeyboard(canonicalPath);
    const lastIndex = messages.length - 1;

    for (let i = 0; i < messages.length; i++) {
      const isLast = i === lastIndex;
      const { text, parseMode } = messages[i];
      if (i === 0) {
        await ctx.updateMessage(text, isLast ? keyboard : undefined, parseMode);
      } else {
        await ctx.sendMessage(text, isLast ? keyboard : undefined, parseMode);
      }
    }

    await ctx.answerCallbackQuery();
  };
}
