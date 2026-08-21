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
  truncateForAskContext,
} from "../userMessages";

const TELEGRAM_MESSAGE_LIMIT = 4096;

export function createAskHandler(deps: AnswerQuestionDeps) {
  return async (ctx: BotContext): Promise<void> => {
    const question = (ctx.messageText ?? "").trim();
    if (question === "") return;

    // Prefer the structured transcript when the marker survived (it's clean
    // Q/A text with the marker itself stripped out, and already
    // size-disciplined from being built up via appendAskTurn on every prior
    // round). If it didn't — e.g. the prior answer was too long to carry the
    // context block at all — fall back to the replied-to message's own
    // visible text: a reply always means "this is relevant," whether or not
    // our own bookkeeping made it through, and something is a far better
    // answer than "I don't know what you're referring to."
    const isMarkedContinuation = isAskContinuation(ctx.replyToMessageText);
    const priorTranscript = isMarkedContinuation
      ? extractAskTranscript(ctx.replyToMessageText ?? "")
      : (ctx.replyToMessageText ?? "");

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
      // would push the last message over Telegram's length limit. The raw
      // fallback text (unlike a marker-extracted transcript) was never
      // capped, so it's truncated here specifically — the model itself still
      // saw it in full a moment ago, this only bounds what gets carried
      // forward into the next hidden block.
      const transcript = appendAskTurn(
        isMarkedContinuation
          ? priorTranscript
          : truncateForAskContext(priorTranscript),
        question,
        answer.text,
      );
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
