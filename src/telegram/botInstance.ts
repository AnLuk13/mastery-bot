import { Redis } from "@upstash/redis";
import type { Bot } from "grammy";
import {
  NullAllowedUsersStore,
  RedisAllowedUsersStore,
  type AllowedUsersStore,
} from "@/admin";
import {
  createContentProvider,
  dispatchWorkflowRun,
  GitHubContentWriter,
} from "@/content";
import { getEnv } from "@/lib/env";
import { embedText } from "@/rag/embeddingModel";
import { getEmbeddingsIndex } from "@/rag/embeddingsIndex";
import { GroqClient } from "@/rag/groqClient";
import {
  NullSessionStore,
  RedisSessionStore,
  type SessionStore,
} from "@/session";
import { createBot } from "./bot";
import type { ContentWriterLike } from "./handlers/save";

/** Never reachable: createSaveHandler/createRevertHandler already deny anyone when EDITORS is empty. */
const DISABLED_CONTENT_WRITER: ContentWriterLike = {
  async write() {
    throw new Error("No editors are configured (EDITORS is empty)");
  },
  async delete() {
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

// mastery-bot's own repo/workflow — see reindex.yml and GitHubContentWriter's
// onContentChanged for why this is event-driven rather than cron-polled.
const REINDEX_WORKFLOW_FILE = "reindex.yml";
const REINDEX_WORKFLOW_REF = "main";

function createRedisClient(env: ReturnType<typeof getEnv>): Redis | undefined {
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) return undefined;
  return new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
}

function createSessionStore(redis: Redis | undefined): SessionStore {
  return redis ? new RedisSessionStore(redis) : new NullSessionStore();
}

function createAllowedUsersStore(redis: Redis | undefined): AllowedUsersStore {
  return redis
    ? new RedisAllowedUsersStore(redis)
    : new NullAllowedUsersStore();
}

/** Best-effort: never awaited or allowed to fail the write it followed (see GitHubContentWriter.onContentChanged). */
function triggerReindex(env: ReturnType<typeof getEnv>): void {
  dispatchWorkflowRun({
    owner: env.GITHUB_OWNER as string,
    repo: env.BOT_REPOSITORY,
    workflowFile: REINDEX_WORKFLOW_FILE,
    ref: REINDEX_WORKFLOW_REF,
    token: env.GITHUB_TOKEN as string,
  }).catch((error: unknown) => {
    console.error("Failed to trigger reindex workflow:", error);
  });
}

function getBot(): Bot {
  if (!bot) {
    const env = getEnv();
    // Shared between /save and /ask's fallback: /save needs GROQ_MODEL for
    // structured JSON output compound models don't support, and it doubles
    // as /ask's fallback when the compound model's much stricter daily quota
    // (shared across every user of this bot, since Groq rate-limits per API
    // key, not per caller) runs out — see answerQuestion.ts.
    const structuredGroq = new GroqClient({
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL,
    });
    const redis = createRedisClient(env);
    bot = createBot({
      token: env.TELEGRAM_BOT_TOKEN,
      contentProvider: createContentProvider(env),
      allowedUserIds: env.ALLOWED_TELEGRAM_USER_IDS,
      adminIds: env.BOT_ADMIN_IDS,
      allowedUsersStore: createAllowedUsersStore(redis),
      askDeps: {
        embed: embedText,
        index: getEmbeddingsIndex(),
        // A Groq "compound" model, agentic and with live web search built in
        // — distinct from GROQ_MODEL, which /save needs for structured JSON
        // output that compound models don't support.
        groq: new GroqClient({
          apiKey: env.GROQ_API_KEY,
          model: env.GROQ_ASK_MODEL,
        }),
        privateFolders: env.PRIVATE_FOLDERS,
        // A second, distinct compound model — still has web search, and
        // Groq tracks its daily quota separately from GROQ_ASK_MODEL's (see
        // GROQ_ASK_FALLBACK_MODEL in env.ts) — tried before giving up web
        // search entirely and dropping to the structured fallback below.
        webSearchFallbackGroq: new GroqClient({
          apiKey: env.GROQ_API_KEY,
          model: env.GROQ_ASK_FALLBACK_MODEL,
        }),
        fallbackGroq: structuredGroq,
      },
      saveGroq: structuredGroq,
      editors: env.EDITORS,
      privateFolders: env.PRIVATE_FOLDERS,
      sessionStore: createSessionStore(redis),
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
              onContentChanged: () => triggerReindex(env),
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
