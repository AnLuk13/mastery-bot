import { InlineKeyboard } from "grammy";
import type { RateLimitInfo } from "@/rag/groqClient";
import {
  encodeLimitsCallbackData,
  encodeNavigateCallbackData,
  SAVE_ANSWER_CALLBACK_DATA,
} from "../callbackData";

const MAX_SOURCE_BUTTONS = 4;

function basename(canonicalPath: string): string {
  const segments = canonicalPath.split("/");
  return segments[segments.length - 1];
}

/**
 * One row per cited source document (so the user can jump straight to it), an
 * optional "Save this" row (only for editors — one tap persists the answer
 * itself as a note, rather than the user needing to know the reply-then-/save
 * trick), an optional Groq usage row (tap to see a toast — Telegram buttons
 * can't be inert/label-only), and Home.
 */
export function buildAskResultKeyboard(
  sources: readonly string[],
  canSave: boolean,
  rateLimit?: RateLimitInfo,
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

  if (canSave) {
    keyboard.text("💾 Save this", SAVE_ANSWER_CALLBACK_DATA).row();
  }

  const limitsData = rateLimit
    ? encodeLimitsCallbackData(rateLimit)
    : undefined;
  if (limitsData) {
    keyboard.text("📊 Groq limits", limitsData).row();
  }

  keyboard.text("🏠 Home", encodeNavigateCallbackData("directory", ""));
  return keyboard;
}
