import { getEnv } from "@/lib/env";
import { getBotApi } from "@/telegram/botInstance";
import {
  handleDeleteWebhookRequest,
  handleGetWebhookInfoRequest,
  handleSetCommandsRequest,
  handleSetWebhookRequest,
} from "@/telegram/setupHandler";

export const runtime = "nodejs";

/** Sets Telegram's webhook. Requires header X-Setup-Secret and JSON body { "url": "https://..." }. */
export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  return handleSetWebhookRequest({
    request,
    setupSecret: env.TELEGRAM_SETUP_SECRET,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    getApi: getBotApi,
  });
}

/** Removes Telegram's webhook. Requires header X-Setup-Secret. */
export async function DELETE(request: Request): Promise<Response> {
  const env = getEnv();
  return handleDeleteWebhookRequest({
    request,
    setupSecret: env.TELEGRAM_SETUP_SECRET,
    getApi: getBotApi,
  });
}

/** Registers the bot's "/" command menu with Telegram. Requires header X-Setup-Secret. */
export async function PUT(request: Request): Promise<Response> {
  const env = getEnv();
  return handleSetCommandsRequest({
    request,
    setupSecret: env.TELEGRAM_SETUP_SECRET,
    getApi: getBotApi,
  });
}

/** Reports current webhook status for verification. Requires header X-Setup-Secret. */
export async function GET(request: Request): Promise<Response> {
  const env = getEnv();
  return handleGetWebhookInfoRequest({
    request,
    setupSecret: env.TELEGRAM_SETUP_SECRET,
    getApi: getBotApi,
  });
}
