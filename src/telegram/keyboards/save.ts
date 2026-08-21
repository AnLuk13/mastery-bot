import { InlineKeyboard } from "grammy";
import {
  encodeNavigateCallbackData,
  encodeRevertCallbackData,
  REORGANIZE_CONFIRM_CALLBACK_DATA,
  REORGANIZE_DECLINE_CALLBACK_DATA,
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

/** Yes/No row for a reorganize proposal (see userMessages.ts's formatReorganizePrompt) — nothing moves until one of these is tapped. */
export function buildReorganizeConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Yes, reorganize", REORGANIZE_CONFIRM_CALLBACK_DATA)
    .text("❌ No, keep separate", REORGANIZE_DECLINE_CALLBACK_DATA);
}

export interface ReorganizeResultTarget {
  label: string;
  path: string;
  beforeCommitSha: string;
  /** False for the old path that got deleted — nothing left there to view. */
  viewable: boolean;
}

/** One row per path a confirmed reorganize touched, each independently revertible via the same generic revert mechanism as a normal save — undoing all of them restores the pre-reorganize state. */
export function buildReorganizeResultKeyboard(
  targets: readonly ReorganizeResultTarget[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  targets.forEach((target, index) => {
    if (index > 0) keyboard.row();
    if (target.viewable) {
      keyboard.text(
        `📄 ${target.label}`,
        encodeNavigateCallbackData("document", target.path),
      );
    }
    const revertData = encodeRevertCallbackData(
      target.path,
      target.beforeCommitSha,
    );
    if (revertData) {
      keyboard.text(`↩️ Undo: ${target.label}`, revertData);
    }
  });

  return keyboard;
}
