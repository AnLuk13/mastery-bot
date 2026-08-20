import { answerQuestion, type AnswerQuestionDeps } from "@/rag/answerQuestion";
import { renderDocumentMessages } from "../formatting";
import { buildAskResultKeyboard } from "../keyboards/ask";
import type { BotContext } from "../types";
import { describeAskError } from "../userMessages";

export function createAskHandler(deps: AnswerQuestionDeps) {
  return async (ctx: BotContext): Promise<void> => {
    const question = (ctx.messageText ?? "").trim();
    if (question === "") return;

    await ctx.sendTyping();

    try {
      const answer = await answerQuestion(question, deps);
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
    } catch (error) {
      await ctx.sendMessage(describeAskError(error));
    }
  };
}
