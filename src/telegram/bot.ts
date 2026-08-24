import { Bot, type BotConfig, type Context } from "grammy";
import type { AllowedUsersStore } from "@/admin";
import type { ContentProvider, PrivateFolderConfig } from "@/content";
import type { EditorConfig } from "@/lib/env";
import type { AnswerQuestionDeps } from "@/rag/answerQuestion";
import type { GroqClient } from "@/rag/groqClient";
import type { SessionStore } from "@/session";
import { adaptContext } from "./adapter";
import {
  createAdminAddPromptHandler,
  createAdminAddUserHandler,
  createAdminHandler,
  createAdminRemoveHandler,
  isAdminAddUserContinuation,
} from "./handlers/admin";
import { enforceAuthorization } from "./auth";
import { decodeCallbackData } from "./callbackData";
import { createAskHandler } from "./handlers/ask";
import { createClearHandler } from "./handlers/clear";
import { createDocumentCallbackHandler } from "./handlers/document";
import { renderDirectory } from "./handlers/navigation";
import {
  createDeleteConfirmHandler,
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
  /** Telegram user ids allowed to use /admin (add/remove allowed users). Empty means the feature is inactive. */
  adminIds: readonly number[];
  /** Backs /admin's dynamic (runtime-added) allowed-user list — layered on top of allowedUserIds, which stays immutable. */
  allowedUsersStore: AllowedUsersStore;
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
    // Merged fresh on every update: allowedUserIds is the immutable env base
    // list, allowedUsersStore holds whatever /admin has added/removed since
    // (see src/admin) — a newly-added user must pass this check with no
    // redeploy needed.
    const dynamicUserIds = await options.allowedUsersStore.list();
    const effectiveAllowedIds = [...allowedUserIds, ...dynamicUserIds];
    if (!(await enforceAuthorization(ctx, effectiveAllowedIds))) return;
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
  const deleteConfirmHandler = createDeleteConfirmHandler(saveDeps);

  bot.command("save", async (grammyCtx) => {
    await saveHandler(adaptContext(grammyCtx));
  });

  const adminDeps = {
    adminIds: options.adminIds,
    baseAllowedUserIds: allowedUserIds,
    allowedUsersStore: options.allowedUsersStore,
  };
  const adminHandler = createAdminHandler(adminDeps);
  const adminAddPromptHandler = createAdminAddPromptHandler(adminDeps);
  const adminAddUserHandler = createAdminAddUserHandler(adminDeps);
  const adminRemoveHandler = createAdminRemoveHandler(adminDeps);

  bot.command("admin", async (grammyCtx) => {
    await adminHandler(adaptContext(grammyCtx));
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
    if (isAdminAddUserContinuation(ctx)) {
      await adminAddUserHandler(ctx);
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
      case "delete-confirm":
        await deleteConfirmHandler(ctx, true);
        break;
      case "delete-decline":
        await deleteConfirmHandler(ctx, false);
        break;
      case "admin-add-prompt":
        await adminAddPromptHandler(ctx);
        break;
      case "admin-remove":
        await adminRemoveHandler(ctx, decoded.userId);
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
