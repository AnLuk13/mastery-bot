import { InlineKeyboard } from "grammy";
import type { ContentProvider } from "@/content";
import { encodeNavigateCallbackData } from "../callbackData";
import { buildDirectoryKeyboard } from "../keyboards/navigation";
import type { BotContext } from "../types";
import { describeContentError } from "../userMessages";

const homeOnlyKeyboard = new InlineKeyboard().text(
  "🏠 Home",
  encodeNavigateCallbackData("directory", ""),
);

function directoryTitle(canonicalPath: string): string {
  if (canonicalPath === "") return "📚 Mastery";
  const segments = canonicalPath.split("/");
  return `📁 ${segments[segments.length - 1]}`;
}

export async function renderDirectory(
  ctx: BotContext,
  provider: ContentProvider,
  canonicalPath: string,
): Promise<void> {
  try {
    const entries = await provider.listDirectory(canonicalPath);
    const keyboard = buildDirectoryKeyboard(entries, canonicalPath);
    await ctx.updateMessage(directoryTitle(canonicalPath), keyboard);
  } catch (error) {
    await ctx.updateMessage(describeContentError(error), homeOnlyKeyboard);
  }
  await ctx.answerCallbackQuery();
}

export function createDirectoryCallbackHandler(provider: ContentProvider) {
  return async (ctx: BotContext, canonicalPath: string): Promise<void> => {
    await renderDirectory(ctx, provider, canonicalPath);
  };
}
