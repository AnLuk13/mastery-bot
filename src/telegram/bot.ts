import { Bot, type BotConfig, type Context } from "grammy";
import type { ContentProvider } from "@/content";
import type { AnswerQuestionDeps } from "@/rag/answerQuestion";
import { adaptContext } from "./adapter";
import { enforceAuthorization } from "./auth";
import { decodeCallbackData } from "./callbackData";
import { createAskHandler } from "./handlers/ask";
import { createClearHandler } from "./handlers/clear";
import { createDocumentCallbackHandler } from "./handlers/document";
import { renderDirectory } from "./handlers/navigation";
import {
  createSearchCommandHandler,
  handleSearchHelpCallback,
} from "./handlers/search";
import { createStartHandler } from "./handlers/start";
import {
  formatRateLimitMessage,
  INVALID_NAVIGATION_MESSAGE,
  TOO_LONG_MESSAGE,
  UNKNOWN_COMMAND_MESSAGE,
} from "./userMessages";

export interface CreateBotOptions {
  token: string;
  contentProvider: ContentProvider;
  allowedUserIds: readonly number[];
  askDeps: AnswerQuestionDeps;
  /** Pass to skip grammY's getMe network call, e.g. in tests. */
  botInfo?: BotConfig<Context>["botInfo"];
}

/**
 * Wires the Telegram layer: authorization runs first for every update, then
 * updates are dispatched to handlers that depend only on ContentProvider —
 * never on the filesystem, GitHub, or process.env directly.
 */
export function createBot(options: CreateBotOptions): Bot {
  const bot = new Bot(
    options.token,
    options.botInfo ? { botInfo: options.botInfo } : undefined,
  );
  const { contentProvider, allowedUserIds } = options;

  bot.use(async (grammyCtx, next) => {
    const ctx = adaptContext(grammyCtx);
    if (!(await enforceAuthorization(ctx, allowedUserIds))) return;
    await next();
  });

  bot.command("start", async (grammyCtx) => {
    await createStartHandler(contentProvider)(adaptContext(grammyCtx));
  });

  bot.command("search", async (grammyCtx) => {
    await createSearchCommandHandler(contentProvider)(adaptContext(grammyCtx));
  });

  bot.command("clear", async (grammyCtx) => {
    await createClearHandler(contentProvider)(adaptContext(grammyCtx));
  });

  const askHandler = createAskHandler(options.askDeps);
  bot.on("message:text", async (grammyCtx) => {
    const text = grammyCtx.message.text;
    if (text.startsWith("/")) {
      // An unrecognized command (the known ones above already returned without
      // calling next()) — don't treat it as a question to the AI.
      await adaptContext(grammyCtx).sendMessage(UNKNOWN_COMMAND_MESSAGE);
      return;
    }
    await askHandler(adaptContext(grammyCtx));
  });

  bot.on("callback_query:data", async (grammyCtx) => {
    const ctx = adaptContext(grammyCtx);
    const decoded = decodeCallbackData(grammyCtx.callbackQuery.data);

    switch (decoded.type) {
      case "directory":
        await renderDirectory(
          ctx,
          contentProvider,
          decoded.path,
          decoded.cleanup,
        );
        break;
      case "document":
        await createDocumentCallbackHandler(contentProvider)(ctx, decoded.path);
        break;
      case "search-help":
        await handleSearchHelpCallback(ctx);
        break;
      case "limits":
        await ctx.answerCallbackQuery(
          formatRateLimitMessage(decoded.rateLimit),
          true,
        );
        break;
      case "too-long":
        await ctx.answerCallbackQuery(TOO_LONG_MESSAGE, true);
        break;
      case "invalid":
        await ctx.answerCallbackQuery(INVALID_NAVIGATION_MESSAGE, true);
        break;
    }
  });

  return bot;
}
