import { InlineKeyboard } from "grammy";
import { parentPath, type ContentEntry } from "@/content";
import {
  encodeNavigateCallbackData,
  SEARCH_HELP_CALLBACK_DATA,
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

export function buildDocumentKeyboard(documentPath: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      "⬅️ Back",
      encodeNavigateCallbackData("directory", parentPath(documentPath)),
    )
    .text("🏠 Home", encodeNavigateCallbackData("directory", ""));
}
