import { InlineKeyboard } from "grammy";
import {
  ContentNotFoundError,
  isPathVisible,
  type ContentProvider,
  type PrivateFolderConfig,
} from "@/content";
import { encodeNavigateCallbackData, type CleanupHint } from "../callbackData";
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
  privateFolders: readonly PrivateFolderConfig[],
  cleanup?: CleanupHint,
): Promise<void> {
  // Acknowledge before doing any slow work (GitHub fetch, message edit): Telegram
  // expires a callback query after a short window, and answering late causes it to
  // retry-deliver the update, compounding the delay. See webhookHandler design notes.
  await ctx.answerCallbackQuery();

  if (cleanup) {
    await ctx.deleteMessages(cleanup.firstMessageId, cleanup.count);
  }

  try {
    // Same "not found", not a distinct "forbidden" message, for a path someone
    // isn't allowed to see — never reveal that a private path even exists.
    if (!isPathVisible(canonicalPath, ctx.userId, privateFolders)) {
      throw new ContentNotFoundError(canonicalPath);
    }
    const entries = (await provider.listDirectory(canonicalPath)).filter(
      (entry) => isPathVisible(entry.path, ctx.userId, privateFolders),
    );
    const keyboard = buildDirectoryKeyboard(entries, canonicalPath);
    await ctx.updateMessage(directoryTitle(canonicalPath), keyboard);
  } catch (error) {
    await ctx.updateMessage(describeContentError(error), homeOnlyKeyboard);
  }
}

export function createDirectoryCallbackHandler(
  provider: ContentProvider,
  privateFolders: readonly PrivateFolderConfig[],
) {
  return async (
    ctx: BotContext,
    canonicalPath: string,
    cleanup?: CleanupHint,
  ): Promise<void> => {
    await renderDirectory(
      ctx,
      provider,
      canonicalPath,
      privateFolders,
      cleanup,
    );
  };
}
