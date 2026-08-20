import {
  isPathVisible,
  type ContentProvider,
  type PrivateFolderConfig,
} from "@/content";
import { buildSearchResultsKeyboard } from "../keyboards/search";
import type { BotContext } from "../types";
import {
  describeContentError,
  formatNoSearchResults,
  formatSearchTitle,
  SEARCH_USAGE_MESSAGE,
} from "../userMessages";

export function createSearchCommandHandler(
  provider: ContentProvider,
  privateFolders: readonly PrivateFolderConfig[],
) {
  return async (ctx: BotContext): Promise<void> => {
    const query = (ctx.commandArgs ?? "").trim();
    if (query === "") {
      await ctx.sendMessage(SEARCH_USAGE_MESSAGE);
      return;
    }

    try {
      const results = (await provider.search(query)).filter((result) =>
        isPathVisible(result.path, ctx.userId, privateFolders),
      );
      if (results.length === 0) {
        await ctx.sendMessage(formatNoSearchResults(query));
        return;
      }
      await ctx.sendMessage(
        formatSearchTitle(query),
        buildSearchResultsKeyboard(results),
      );
    } catch (error) {
      await ctx.sendMessage(describeContentError(error));
    }
  };
}

/** The [🔎 Search] button can't collect free-text input without server-side conversational state, so it just points users at the /search command. */
export async function handleSearchHelpCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery(SEARCH_USAGE_MESSAGE, true);
}
