import { InlineKeyboard } from "grammy";
import { parentPath, type ContentEntry } from "@/content";
import {
  encodeNavigateCallbackData,
  SEARCH_HELP_CALLBACK_DATA,
  type CleanupHint,
} from "../callbackData";

export function buildDirectoryKeyboard(
  entries: readonly ContentEntry[],
  currentPath: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const entry of entries) {
    const icon = entry.type === "directory" ? "📁" : "📄";
    const kind = entry.type === "directory" ? "directory" : "document";
    keyboard
      .text(
        `${icon} ${entry.name}`,
        encodeNavigateCallbackData(kind, entry.path),
      )
      .row();
  }

  if (currentPath === "") {
    keyboard.text("🔎 Search", SEARCH_HELP_CALLBACK_DATA);
  } else {
    keyboard
      .text(
        "⬅️ Back",
        encodeNavigateCallbackData("directory", parentPath(currentPath)),
      )
      .text("🏠 Home", encodeNavigateCallbackData("directory", ""));
  }

  return keyboard;
}

/**
 * `cleanup`, when the document being viewed overflowed into multiple
 * Telegram messages, tells Back/Home to delete the extra ones first so only
 * the menu is left on screen — see callbackData.ts for why this is safe
 * without any server-side state.
 */
export function buildDocumentKeyboard(
  documentPath: string,
  cleanup?: CleanupHint,
): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      "⬅️ Back",
      encodeNavigateCallbackData(
        "directory",
        parentPath(documentPath),
        cleanup,
      ),
    )
    .text("🏠 Home", encodeNavigateCallbackData("directory", "", cleanup));
}
