import { InlineKeyboard } from "grammy";
import {
  ADMIN_ADD_PROMPT_CALLBACK_DATA,
  encodeAdminRemoveCallbackData,
} from "../callbackData";

/**
 * One Remove button per dynamically-added user (base env users from
 * ALLOWED_TELEGRAM_USER_IDS aren't removable via the bot — see
 * findEditorFolder-style "can't lock out the base list" reasoning in
 * handlers/admin.ts), plus an Add button.
 */
export function buildAdminKeyboard(dynamicUserIds: readonly number[]) {
  const keyboard = new InlineKeyboard();

  dynamicUserIds.forEach((userId) => {
    keyboard.text(`❌ Remove ${userId}`, encodeAdminRemoveCallbackData(userId));
    keyboard.row();
  });

  keyboard.text("➕ Add user", ADMIN_ADD_PROMPT_CALLBACK_DATA);
  return keyboard;
}
