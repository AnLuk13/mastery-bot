import { InlineKeyboard } from "grammy";
import type { SearchResult } from "@/content";
import { encodeNavigateCallbackData } from "../callbackData";

/** "networking-mastery/01-tcp.md" -> "networking-mastery / 01-tcp.md" — no assumptions about naming, just a readable separator. */
function displayLabel(path: string): string {
  return path.split("/").join(" / ");
}

export function buildSearchResultsKeyboard(
  results: readonly SearchResult[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  results.forEach((result, index) => {
    if (index > 0) keyboard.row();
    keyboard.text(
      `📄 ${displayLabel(result.path)}`,
      encodeNavigateCallbackData("document", result.path),
    );
  });
  return keyboard;
}
