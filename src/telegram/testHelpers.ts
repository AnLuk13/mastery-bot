/** Test-only fakes for BotContext and ContentProvider; not imported by application code. */
import type { InlineKeyboard } from "grammy";
import { ContentNotFoundError, type ContentProvider } from "@/content";
import type { BotContext, ParseMode } from "./types";

export interface RecordedCall {
  text: string;
  keyboard?: InlineKeyboard;
  parseMode?: ParseMode;
}

export interface RecordedAnswer {
  text?: string;
  showAlert?: boolean;
}

export interface RecordedDeleteMessages {
  fromMessageId: number;
  count: number;
}

export interface FakeBotContext {
  ctx: BotContext;
  sendMessageCalls: RecordedCall[];
  updateMessageCalls: RecordedCall[];
  answerCallbackQueryCalls: RecordedAnswer[];
  deleteMessagesCalls: RecordedDeleteMessages[];
}

export function createFakeBotContext(
  overrides: Partial<{
    userId: number;
    callbackData: string;
    commandArgs: string;
    messageId: number;
  }> = {},
): FakeBotContext {
  const sendMessageCalls: RecordedCall[] = [];
  const updateMessageCalls: RecordedCall[] = [];
  const answerCallbackQueryCalls: RecordedAnswer[] = [];
  const deleteMessagesCalls: RecordedDeleteMessages[] = [];

  const ctx: BotContext = {
    userId: overrides.userId,
    callbackData: overrides.callbackData,
    commandArgs: overrides.commandArgs,
    messageId: overrides.messageId,
    async sendMessage(text, keyboard, parseMode) {
      sendMessageCalls.push({ text, keyboard, parseMode });
    },
    async updateMessage(text, keyboard, parseMode) {
      updateMessageCalls.push({ text, keyboard, parseMode });
    },
    async answerCallbackQuery(text, showAlert) {
      answerCallbackQueryCalls.push({ text, showAlert });
    },
    async deleteMessages(fromMessageId, count) {
      deleteMessagesCalls.push({ fromMessageId, count });
    },
  };

  return {
    ctx,
    sendMessageCalls,
    updateMessageCalls,
    answerCallbackQueryCalls,
    deleteMessagesCalls,
  };
}

export function createFakeContentProvider(
  overrides: Partial<ContentProvider> = {},
): ContentProvider {
  return {
    listDirectory: overrides.listDirectory ?? (async () => []),
    getDocument:
      overrides.getDocument ??
      (async (path: string) => {
        throw new ContentNotFoundError(path);
      }),
    search: overrides.search ?? (async () => []),
  };
}
