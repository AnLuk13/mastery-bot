import { InlineKeyboard } from "grammy";
import {
  encodeNavigateCallbackData,
  encodeRevertCallbackData,
} from "../callbackData";

/** View jumps to the saved doc in the normal browsing UI; Revert is omitted if it can't fit callback_data's budget. */
export function buildSaveResultKeyboard(
  path: string,
  beforeCommitSha: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    "📄 View",
    encodeNavigateCallbackData("document", path),
  );

  const revertData = encodeRevertCallbackData(path, beforeCommitSha);
  if (revertData) {
    keyboard.text("↩️ Revert", revertData);
  }

  return keyboard;
}
