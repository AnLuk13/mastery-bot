import type { Bot } from "grammy";
import { createContentProvider, GitHubContentWriter } from "@/content";
import { getEnv } from "@/lib/env";
import { embedText } from "@/rag/embeddingModel";
import { getEmbeddingsIndex } from "@/rag/embeddingsIndex";
import { GroqClient } from "@/rag/groqClient";
import { createBot } from "./bot";
import type { ContentWriterLike } from "./handlers/save";

/** Never reachable: createSaveHandler/createRevertHandler already deny anyone when EDITORS is empty. */
const DISABLED_CONTENT_WRITER: ContentWriterLike = {
  async write() {
    throw new Error("No editors are configured (EDITORS is empty)");
  },
  async revert() {
    throw new Error("No editors are configured (EDITORS is empty)");
  },
};

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
      askDeps: {
        embed: embedText,
        index: getEmbeddingsIndex(),
        groq: new GroqClient({
          apiKey: env.GROQ_API_KEY,
          model: env.GROQ_MODEL,
        }),
        privateFolders: env.PRIVATE_FOLDERS,
      },
      editors: env.EDITORS,
      privateFolders: env.PRIVATE_FOLDERS,
      // /save always writes to GitHub directly regardless of CONTENT_PROVIDER
      // (env.ts requires GITHUB_OWNER/GITHUB_REPOSITORY/GITHUB_TOKEN whenever
      // EDITORS is non-empty, so these are guaranteed present here).
      contentWriter:
        env.EDITORS.length > 0
          ? new GitHubContentWriter({
              owner: env.GITHUB_OWNER as string,
              repo: env.GITHUB_REPOSITORY as string,
              branch: env.GITHUB_BRANCH,
              contentPath: env.GITHUB_CONTENT_PATH ?? "",
              token: env.GITHUB_TOKEN,
            })
          : DISABLED_CONTENT_WRITER,
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
