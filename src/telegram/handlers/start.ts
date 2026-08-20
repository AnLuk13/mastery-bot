import type { ContentProvider } from "@/content";
import { renderDirectory } from "./navigation";
import type { BotContext } from "../types";

export function createStartHandler(provider: ContentProvider) {
  return async (ctx: BotContext): Promise<void> => {
    await renderDirectory(ctx, provider, "");
  };
}
