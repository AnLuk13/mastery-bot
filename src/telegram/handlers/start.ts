import type { ContentProvider, PrivateFolderConfig } from "@/content";
import { renderDirectory } from "./navigation";
import type { BotContext } from "../types";

export function createStartHandler(
  provider: ContentProvider,
  privateFolders: readonly PrivateFolderConfig[],
) {
  return async (ctx: BotContext): Promise<void> => {
    await renderDirectory(ctx, provider, "", privateFolders);
  };
}
