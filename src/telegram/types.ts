import type { InlineKeyboard } from "grammy";

/**
 * The interface every handler/keyboard-consuming function programs against,
 * instead of grammY's Context directly. Keeps business logic testable with
 * a plain object (see adapter.ts for the real grammY-backed implementation)
 * and keeps grammY's API surface out of the rest of the Telegram layer.
 */
export type ParseMode = "HTML";

export interface BotContext {
  readonly userId: number | undefined;
  readonly callbackData: string | undefined;
  readonly commandArgs: string | undefined;
  /** message_id of the callback's attached message, or of the incoming message itself for a command/plain message. */
  readonly messageId: number | undefined;
  /** Text of an incoming plain message; undefined for callbacks and commands. */
  readonly messageText: string | undefined;
  /** Text of the message this one is a Telegram reply to, if any (used to detect a save-clarify follow-up). */
  readonly replyToMessageText: string | undefined;
  /** Text of the message a callback button is attached to, when reached via a callback query (e.g. the "Save this" button on an /ask answer). Undefined for plain messages/commands, or if the message is too old for Telegram to include its text. */
  readonly callbackMessageText: string | undefined;
  /** Present when the incoming message is a file upload. */
  readonly document:
    | { fileId: string; fileName: string; mimeType: string | undefined }
    | undefined;
  /** Downloads a document's text content. Throws if it's too large or can't be fetched. */
  downloadDocument(fileId: string): Promise<string>;
  sendMessage(
    text: string,
    keyboard?: InlineKeyboard,
    parseMode?: ParseMode,
  ): Promise<void>;
  /** Edits the current message in place when reached via a callback tap; otherwise sends a new message. */
  updateMessage(
    text: string,
    keyboard?: InlineKeyboard,
    parseMode?: ParseMode,
  ): Promise<void>;
  /** No-op when there is no callback query to answer (e.g. a plain command). */
  answerCallbackQuery(text?: string, showAlert?: boolean): Promise<void>;
  /** Best-effort deletes `count` consecutive messages starting at `fromMessageId`; failures on individual IDs are swallowed. */
  deleteMessages(fromMessageId: number, count: number): Promise<void>;
  /** Best-effort "typing…" indicator; never blocks or throws. */
  sendTyping(): Promise<void>;
}
