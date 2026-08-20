import { getEnv } from "@/lib/env";
import { getInitializedBot } from "@/telegram/botInstance";
import { handleWebhookRequest } from "@/telegram/webhookHandler";

// Uses Node crypto (timing-safe secret comparison) and the full grammY bot — not Edge-compatible.
export const runtime = "nodejs";
// Default 10s is too tight for /ask: local embedding + Groq call can take a few
// seconds, more on a cold start that has to load the bundled MiniLM model.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  return handleWebhookRequest({
    request,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    getInitializedBot,
  });
}
