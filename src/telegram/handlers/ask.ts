import { answerQuestion, type AnswerQuestionDeps } from "@/rag/answerQuestion";
import { renderDocumentMessages } from "../formatting";
import { buildAskResultKeyboard } from "../keyboards/ask";
import type { BotContext } from "../types";
import {
  appendAskTurn,
  describeAskError,
  extractAskTranscript,
  formatAskContextBlock,
  isAskContinuation,
} from "../userMessages";

const TELEGRAM_MESSAGE_LIMIT = 4096;

export function createAskHandler(deps: AnswerQuestionDeps) {
  return async (ctx: BotContext): Promise<void> => {
    const question = (ctx.messageText ?? "").trim();
    if (question === "") return;

    const priorTranscript = isAskContinuation(ctx.replyToMessageText)
      ? extractAskTranscript(ctx.replyToMessageText ?? "")
      : "";

    await ctx.sendTyping();

    try {
      const answer = await answerQuestion(
        question,
        ctx.userId,
        deps,
        priorTranscript,
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

      // Every answer embeds the FULL running transcript (not just this turn) in
      // an invisible-until-tapped spoiler block, so replying to it — or to any
      // earlier answer in the same chain — carries the whole conversation so
      // far back in, with no server-side session needed. Dropped silently if it
      // would push the last message over Telegram's length limit.
      const transcript = appendAskTurn(priorTranscript, question, answer.text);
      const contextBlock = formatAskContextBlock(transcript);

      for (let i = 0; i < messages.length; i++) {
        const { text, parseMode } = messages[i];
        const isLast = i === lastIndex;
        const withContext =
          isLast && text.length + contextBlock.length <= TELEGRAM_MESSAGE_LIMIT
            ? text + contextBlock
            : text;
        await ctx.sendMessage(
          withContext,
          isLast ? keyboard : undefined,
          parseMode,
        );
      }
    } catch (error) {
      await ctx.sendMessage(describeAskError(error));
    }
  };
}
