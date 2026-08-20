import type { Bot } from "grammy";
import { createContentProvider } from "@/content";
import { getEnv } from "@/lib/env";
import { createBot } from "./bot";

/**
 * Module-scope singleton, reused across warm Vercel invocations as a pure
 * optimization (skips reconstructing the bot / re-fetching botInfo). Never a
 * correctness dependency: a fresh cold start rebuilds this identically, so
 * losing it changes nothing about behavior, only cold-start latency.
 */
let bot: Bot | undefined;
let initPromise: Promise<void> | undefined;

function getBot(): Bot {
  if (!bot) {
    const env = getEnv();
    bot = createBot({
      token: env.TELEGRAM_BOT_TOKEN,
      contentProvider: createContentProvider(env),
      allowedUserIds: env.ALLOWED_TELEGRAM_USER_IDS,
    });
  }
  return bot;
}

/** grammY requires `bot.init()` (one `getMe` call) before `handleUpdate` will work. */
export async function getInitializedBot(): Promise<Bot> {
  const instance = getBot();
  if (!instance.isInited()) {
    initPromise ??= instance.init();
    await initPromise;
  }
  return instance;
}

/** Doesn't require init() — setWebhook/deleteWebhook/getWebhookInfo work without botInfo. */
export function getBotApi(): Bot["api"] {
  return getBot().api;
}
