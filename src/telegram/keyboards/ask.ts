import { InlineKeyboard } from "grammy";
import { encodeNavigateCallbackData } from "../callbackData";

const MAX_SOURCE_BUTTONS = 4;

function basename(canonicalPath: string): string {
  const segments = canonicalPath.split("/");
  return segments[segments.length - 1];
}

/** One row per cited source document (so the user can jump straight to it), plus Home. */
export function buildAskResultKeyboard(
  sources: readonly string[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const source of sources.slice(0, MAX_SOURCE_BUTTONS)) {
    keyboard
      .text(
        `📄 ${basename(source)}`,
        encodeNavigateCallbackData("document", source),
      )
      .row();
  }

  keyboard.text("🏠 Home", encodeNavigateCallbackData("directory", ""));
  return keyboard;
}
