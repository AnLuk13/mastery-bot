import { isPathVisible, type ContentProvider } from "@/content";
import { answerQuestion, type AnswerQuestionDeps } from "@/rag/answerQuestion";
import type { SessionStore } from "@/session";
import { renderDocumentMessages } from "../formatting";
import { buildAskResultKeyboard } from "../keyboards/ask";
import type { BotContext } from "../types";
import { appendAskTurn, describeAskError } from "../userMessages";

export function createAskHandler(
  deps: AnswerQuestionDeps,
  contentProvider: ContentProvider,
  sessionStore: SessionStore,
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
      const keyboard = buildAskResultKeyboard(answer.sources, answer.rateLimit);
      const lastIndex = messages.length - 1;

      for (let i = 0; i < messages.length; i++) {
        const { text, parseMode } = messages[i];
        await ctx.sendMessage(
          text,
          i === lastIndex ? keyboard : undefined,
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
