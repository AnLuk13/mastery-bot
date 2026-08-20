import { answerQuestion, type AnswerQuestionDeps } from "@/rag/answerQuestion";
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
      const keyboard =
        answer.sources.length > 0
          ? buildAskResultKeyboard(answer.sources)
          : undefined;
      await ctx.sendMessage(answer.text, keyboard);
    } catch (error) {
      await ctx.sendMessage(describeAskError(error));
    }
  };
}
