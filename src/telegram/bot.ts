import { Bot, type BotConfig, type Context } from "grammy";
import type { ContentProvider, PrivateFolderConfig } from "@/content";
import type { EditorConfig } from "@/lib/env";
import type { AnswerQuestionDeps } from "@/rag/answerQuestion";
import type { GroqClient } from "@/rag/groqClient";
import type { SessionStore } from "@/session";
import { adaptContext } from "./adapter";
import { enforceAuthorization } from "./auth";
import { decodeCallbackData } from "./callbackData";
import { createAskHandler } from "./handlers/ask";
import { createClearHandler } from "./handlers/clear";
import { createDocumentCallbackHandler } from "./handlers/document";
import { renderDirectory } from "./handlers/navigation";
import {
  createReorganizeConfirmHandler,
  createRevertHandler,
  createSaveFromMessageHandler,
  createSaveHandler,
  isSaveClarifyContinuation,
  type ContentWriterLike,
} from "./handlers/save";
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
  editors: readonly EditorConfig[];
  contentWriter: ContentWriterLike;
  /** /save's model client — deliberately separate from askDeps.groq: /ask and /save use different Groq models with different capabilities. */
  saveGroq: Pick<GroqClient, "createChatCompletion">;
  privateFolders: readonly PrivateFolderConfig[];
  /** Ambient /ask conversation memory — see src/session. */
  sessionStore: SessionStore;
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
  const { contentProvider, allowedUserIds, privateFolders, sessionStore } =
    options;

  bot.use(async (grammyCtx, next) => {
    const ctx = adaptContext(grammyCtx);
    if (!(await enforceAuthorization(ctx, allowedUserIds))) return;
    await next();
  });

  bot.command("start", async (grammyCtx) => {
    await createStartHandler(
      contentProvider,
      privateFolders,
    )(adaptContext(grammyCtx));
  });

  bot.command("search", async (grammyCtx) => {
    await createSearchCommandHandler(
      contentProvider,
      privateFolders,
    )(adaptContext(grammyCtx));
  });

  bot.command("clear", async (grammyCtx) => {
    await createClearHandler(
      contentProvider,
      privateFolders,
      sessionStore,
    )(adaptContext(grammyCtx));
  });

  const saveDeps = {
    editors: options.editors,
    contentProvider,
    contentWriter: options.contentWriter,
    groq: options.saveGroq,
    sessionStore,
  };
  const saveHandler = createSaveHandler(saveDeps);
  const saveFromMessageHandler = createSaveFromMessageHandler(saveDeps);
  const reorganizeConfirmHandler = createReorganizeConfirmHandler(saveDeps);

  bot.command("save", async (grammyCtx) => {
    await saveHandler(adaptContext(grammyCtx));
  });

  // Unambiguous by message type alone — no command needed. Non-editors and
  // unsupported file types are rejected inside the handler itself.
  bot.on("message:document", async (grammyCtx) => {
    await saveHandler(adaptContext(grammyCtx));
  });

  const askHandler = createAskHandler(
    options.askDeps,
    contentProvider,
    sessionStore,
    options.editors,
  );
  bot.on("message:text", async (grammyCtx) => {
    const ctx = adaptContext(grammyCtx);
    const text = grammyCtx.message.text;
    if (text.startsWith("/")) {
      // An unrecognized command (the known ones above already returned without
      // calling next()) — don't treat it as a question to the AI.
      await ctx.sendMessage(UNKNOWN_COMMAND_MESSAGE);
      return;
    }
    if (isSaveClarifyContinuation(ctx)) {
      await saveHandler(ctx);
      return;
    }
    await askHandler(ctx);
  });

  const revertHandler = createRevertHandler(
    options.editors,
    options.contentWriter,
  );

  bot.on("callback_query:data", async (grammyCtx) => {
    const ctx = adaptContext(grammyCtx);
    const decoded = decodeCallbackData(grammyCtx.callbackQuery.data);

    switch (decoded.type) {
      case "revert":
        await revertHandler(ctx, decoded.target);
        break;
      case "directory":
        await renderDirectory(
          ctx,
          contentProvider,
          decoded.path,
          privateFolders,
          decoded.cleanup,
        );
        break;
      case "document":
        await createDocumentCallbackHandler(
          contentProvider,
          privateFolders,
          sessionStore,
        )(ctx, decoded.path);
        break;
      case "save-answer":
        await saveFromMessageHandler(ctx);
        break;
      case "reorganize-confirm":
        await reorganizeConfirmHandler(ctx, true);
        break;
      case "reorganize-decline":
        await reorganizeConfirmHandler(ctx, false);
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
