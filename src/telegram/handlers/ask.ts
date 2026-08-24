import { isPathVisible, type ContentProvider } from "@/content";
import type { EditorConfig } from "@/lib/env";
import { answerQuestion, type AnswerQuestionDeps } from "@/rag/answerQuestion";
import type { SessionStore } from "@/session";
import { findEditorFolder } from "../auth";
import { renderDocumentMessages } from "../formatting";
import { buildAskResultKeyboard } from "../keyboards/ask";
import type { BotContext } from "../types";
import {
  appendAskTurn,
  describeAskError,
  formatFallbackNotice,
} from "../userMessages";

const TELEGRAM_MESSAGE_LIMIT = 4096;

export function createAskHandler(
  deps: AnswerQuestionDeps,
  contentProvider: ContentProvider,
  sessionStore: SessionStore,
  editors: readonly EditorConfig[],
) {
  return async (ctx: BotContext): Promise<void> => {
    const question = (ctx.messageText ?? "").trim();
    if (question === "" || ctx.userId === undefined) return;

    await ctx.sendTyping();

    const session = await sessionStore.get(ctx.userId);

    // The document the user was last browsing (if any, and still visible to
    // them) rides along as ambient context — no reply needed. Re-fetched
    // fresh each time rather than cached, so it can never go stale and a
    // deleted/renamed document just silently drops out of context.
    let referenceDocument: { path: string; content: string } | undefined;
    if (
      session.documentPath !== undefined &&
      isPathVisible(session.documentPath, ctx.userId, deps.privateFolders)
    ) {
      try {
        const document = await contentProvider.getDocument(
          session.documentPath,
        );
        referenceDocument = {
          path: session.documentPath,
          content: document.content,
        };
      } catch {
        // Gone or unreachable — proceed without it rather than failing the question.
      }
    }

    try {
      const answer = await answerQuestion(
        question,
        ctx.userId,
        deps,
        session.transcript,
        referenceDocument,
      );
      // The model's Markdown answer goes through the same Markdown->Telegram-HTML
      // pipeline used for documents, so bold/bullets/etc. render properly instead
      // of showing up as literal asterisks — and long answers split safely too.
      const messages = renderDocumentMessages({
        path: "",
        name: "",
        content: answer.text,
      });
      const canSave = findEditorFolder(ctx.userId, editors) !== undefined;
      const keyboard = buildAskResultKeyboard(
        answer.sources,
        canSave,
        answer.rateLimit,
      );
      const lastIndex = messages.length - 1;
      const fallbackNotice = answer.usedFallback
        ? formatFallbackNotice(answer.fallbackReason ?? "unavailable")
        : "";

      for (let i = 0; i < messages.length; i++) {
        const { text, parseMode } = messages[i];
        const isLast = i === lastIndex;
        // Best-effort: if the notice would push the last chunk over
        // Telegram's limit, just drop it rather than fail the whole answer
        // over a footer.
        const withNotice =
          isLast &&
          text.length + fallbackNotice.length <= TELEGRAM_MESSAGE_LIMIT
            ? text + fallbackNotice
            : text;
        await ctx.sendMessage(
          withNotice,
          isLast ? keyboard : undefined,
          parseMode,
        );
      }

      await sessionStore.set(ctx.userId, {
        ...session,
        transcript: appendAskTurn(session.transcript, question, answer.text),
      });
    } catch (error) {
      await ctx.sendMessage(describeAskError(error));
    }
  };
}
