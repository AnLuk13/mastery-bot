import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { BotContext, ParseMode } from "./types";

function replyOptions(
  keyboard: InlineKeyboard | undefined,
  parseMode: ParseMode | undefined,
) {
  if (!keyboard && !parseMode) return undefined;
  return { reply_markup: keyboard, parse_mode: parseMode };
}

// Generous for a "saved note" but far below Telegram's own 20MB bot-download
// cap — keeps uploads from blowing up the Groq prompt built from them.
const MAX_DOWNLOADABLE_DOCUMENT_BYTES = 200_000;

/** Wraps a real grammY Context so handlers never touch grammY's API directly. */
export function adaptContext(ctx: Context): BotContext {
  return {
    userId: ctx.from?.id,
    callbackData: ctx.callbackQuery?.data,
    commandArgs: typeof ctx.match === "string" ? ctx.match : undefined,
    messageId:
      ctx.callbackQuery?.message?.message_id ?? ctx.message?.message_id,
    messageText: ctx.callbackQuery ? undefined : ctx.message?.text,
    replyToMessageText:
      ctx.message?.reply_to_message && "text" in ctx.message.reply_to_message
        ? ctx.message.reply_to_message.text
        : undefined,
    callbackMessageText:
      ctx.callbackQuery?.message && "text" in ctx.callbackQuery.message
        ? ctx.callbackQuery.message.text
        : undefined,
    document: ctx.message?.document
      ? {
          fileId: ctx.message.document.file_id,
          fileName: ctx.message.document.file_name ?? "file",
          mimeType: ctx.message.document.mime_type,
        }
      : undefined,

    async downloadDocument(fileId) {
      const file = await ctx.api.getFile(fileId);
      if (file.file_size && file.file_size > MAX_DOWNLOADABLE_DOCUMENT_BYTES) {
        throw new Error("File is too large");
      }
      if (!file.file_path) {
        throw new Error("Telegram did not return a file path");
      }
      const response = await fetch(
        `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`,
      );
      if (!response.ok) {
        throw new Error(`Failed to download file (${response.status})`);
      }
      const text = await response.text();
      if (text.length > MAX_DOWNLOADABLE_DOCUMENT_BYTES) {
        throw new Error("File is too large");
      }
      return text;
    },

    async sendMessage(text, keyboard, parseMode) {
      await ctx.reply(text, replyOptions(keyboard, parseMode));
    },

    async updateMessage(text, keyboard, parseMode) {
      if (ctx.callbackQuery?.message) {
        try {
          await ctx.editMessageText(text, replyOptions(keyboard, parseMode));
          return;
        } catch {
          // Falls through to reply, e.g. if the message is too old to edit
          // or content is unchanged ("message is not modified").
        }
      }
      await ctx.reply(text, replyOptions(keyboard, parseMode));
    },

    async sendTyping() {
      try {
        await ctx.replyWithChatAction("typing");
      } catch {
        // Best-effort only: never blocks the actual reply.
      }
    },

    async answerCallbackQuery(text, showAlert) {
      if (!ctx.callbackQuery) return;
      await ctx.answerCallbackQuery(
        text ? { text, show_alert: showAlert ?? false } : undefined,
      );
    },

    async deleteMessages(fromMessageId, count) {
      const chatId = ctx.chat?.id;
      if (chatId === undefined) return;

      await Promise.all(
        Array.from(
          { length: count },
          (_, offset) => fromMessageId + offset,
        ).map(async (messageId) => {
          try {
            await ctx.api.deleteMessage(chatId, messageId);
          } catch {
            // Best-effort: already deleted, too old, or the consecutive-ID
            // assumption didn't hold for this one — never block navigation on it.
          }
        }),
      );
    },
  };
}
