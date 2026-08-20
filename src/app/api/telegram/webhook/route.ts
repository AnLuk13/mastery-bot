import { getEnv } from "@/lib/env";
import { getInitializedBot } from "@/telegram/botInstance";
import { handleWebhookRequest } from "@/telegram/webhookHandler";

// Uses Node crypto (timing-safe secret comparison) and the full grammY bot — not Edge-compatible.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  return handleWebhookRequest({
    request,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    getInitializedBot,
  });
}
