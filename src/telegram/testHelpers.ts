/** Test-only fakes for BotContext and ContentProvider; not imported by application code. */
import type { InlineKeyboard } from "grammy";
import type { AllowedUsersStore } from "@/admin";
import { ContentNotFoundError, type ContentProvider } from "@/content";
import { EMPTY_SESSION, type Session, type SessionStore } from "@/session";
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
    callbackMessageText: string;
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
    callbackMessageText: overrides.callbackMessageText,
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
    // Absent by default, same as LocalFilesystemContentProvider (no commit
    // concept) — pass a fake explicitly to test GitHub-provider behavior.
    getLatestCommit: overrides.getLatestCommit,
  };
}

export interface FakeContentWriter {
  write(
    path: string,
    content: string,
    message: string,
  ): Promise<{ path: string; beforeCommitSha: string }>;
  delete(
    path: string,
    message: string,
  ): Promise<{ path: string; beforeCommitSha: string }>;
  revert(path: string, beforeCommitSha: string, message: string): Promise<void>;
}

export interface RecordedWrite {
  path: string;
  content: string;
  message: string;
}

export interface RecordedDelete {
  path: string;
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
    onDelete: (del: RecordedDelete) => void;
    onRevert: (revert: RecordedRevert) => void;
  }> = {},
): {
  writer: FakeContentWriter;
  writes: RecordedWrite[];
  deletes: RecordedDelete[];
  reverts: RecordedRevert[];
} {
  const writes: RecordedWrite[] = [];
  const deletes: RecordedDelete[] = [];
  const reverts: RecordedRevert[] = [];
  let commitCounter = 0;
  const nextSha = () =>
    overrides.beforeCommitSha ?? `commit-${commitCounter++}`;

  const writer: FakeContentWriter = {
    async write(path, content, message) {
      writes.push({ path, content, message });
      overrides.onWrite?.({ path, content, message });
      return { path, beforeCommitSha: nextSha() };
    },
    async delete(path, message) {
      deletes.push({ path, message });
      overrides.onDelete?.({ path, message });
      return { path, beforeCommitSha: nextSha() };
    },
    async revert(path, beforeCommitSha, message) {
      reverts.push({ path, beforeCommitSha, message });
      overrides.onRevert?.({ path, beforeCommitSha, message });
    },
  };

  return { writer, writes, deletes, reverts };
}

export function createFakeAllowedUsersStore(
  initial: number[] = [],
): AllowedUsersStore & { ids: number[] } {
  const ids = [...initial];

  return {
    ids,
    async list() {
      return [...ids];
    },
    async add(userId) {
      if (!ids.includes(userId)) ids.push(userId);
    },
    async remove(userId) {
      const index = ids.indexOf(userId);
      if (index !== -1) ids.splice(index, 1);
    },
  };
}

export function createFakeSessionStore(
  initial: Record<number, Session> = {},
): SessionStore & { sessions: Record<number, Session> } {
  const sessions: Record<number, Session> = { ...initial };

  return {
    sessions,
    async get(userId) {
      return sessions[userId] ?? EMPTY_SESSION;
    },
    async set(userId, session) {
      sessions[userId] = session;
    },
    async clear(userId) {
      delete sessions[userId];
    },
  };
}
