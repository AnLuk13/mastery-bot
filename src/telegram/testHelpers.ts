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
  sendTypingCalls: number[];
}

export function createFakeBotContext(
  overrides: Partial<{
    userId: number;
    callbackData: string;
    commandArgs: string;
    messageId: number;
    messageText: string;
    replyToMessageText: string;
    document: {
      fileId: string;
      fileName: string;
      mimeType: string | undefined;
    };
    downloadDocument: (fileId: string) => Promise<string>;
  }> = {},
): FakeBotContext {
  const sendMessageCalls: RecordedCall[] = [];
  const updateMessageCalls: RecordedCall[] = [];
  const answerCallbackQueryCalls: RecordedAnswer[] = [];
  const deleteMessagesCalls: RecordedDeleteMessages[] = [];
  const sendTypingCalls: number[] = [];

  const ctx: BotContext = {
    userId: overrides.userId,
    callbackData: overrides.callbackData,
    commandArgs: overrides.commandArgs,
    messageId: overrides.messageId,
    messageText: overrides.messageText,
    replyToMessageText: overrides.replyToMessageText,
    document: overrides.document,
    downloadDocument:
      overrides.downloadDocument ??
      (async () => {
        throw new Error("no fake document content configured");
      }),
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
    async sendTyping() {
      sendTypingCalls.push(sendTypingCalls.length);
    },
  };

  return {
    ctx,
    sendMessageCalls,
    updateMessageCalls,
    answerCallbackQueryCalls,
    deleteMessagesCalls,
    sendTypingCalls,
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

export interface FakeContentWriter {
  write(
    path: string,
    content: string,
    message: string,
  ): Promise<{ path: string; beforeCommitSha: string }>;
  revert(path: string, beforeCommitSha: string, message: string): Promise<void>;
}

export interface RecordedWrite {
  path: string;
  content: string;
  message: string;
}

export interface RecordedRevert {
  path: string;
  beforeCommitSha: string;
  message: string;
}

export function createFakeContentWriter(
  overrides: Partial<{
    beforeCommitSha: string;
    onWrite: (write: RecordedWrite) => void;
    onRevert: (revert: RecordedRevert) => void;
  }> = {},
): {
  writer: FakeContentWriter;
  writes: RecordedWrite[];
  reverts: RecordedRevert[];
} {
  const writes: RecordedWrite[] = [];
  const reverts: RecordedRevert[] = [];

  const writer: FakeContentWriter = {
    async write(path, content, message) {
      writes.push({ path, content, message });
      overrides.onWrite?.({ path, content, message });
      return { path, beforeCommitSha: overrides.beforeCommitSha ?? "commit-0" };
    },
    async revert(path, beforeCommitSha, message) {
      reverts.push({ path, beforeCommitSha, message });
      overrides.onRevert?.({ path, beforeCommitSha, message });
    },
  };

  return { writer, writes, reverts };
}
