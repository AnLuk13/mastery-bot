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
}
