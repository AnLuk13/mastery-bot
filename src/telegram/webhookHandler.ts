import { z } from "zod";
import { secureCompare } from "@/lib/secureCompare";

/**
 * Only what handleWebhookRequest actually calls. A real grammY `Bot`
 * satisfies this structurally, but tests can supply a plain fake without
 * constructing a real bot or touching the network.
 */
export interface UpdateHandler {
  handleUpdate(update: unknown): Promise<void>;
}

export interface HandleWebhookRequestOptions {
  request: Request;
  webhookSecret: string;
  getInitializedBot: () => Promise<UpdateHandler>;
}

// Only validates that the body is update-shaped enough to be worth dispatching;
// the full Telegram Update schema is large and grammY itself already no-ops
// gracefully on updates that don't match any registered handler.
const updateShapeSchema = z.object({ update_id: z.number() });

/**
 * Handles one Telegram webhook POST: validates the shared secret, validates
 * the body is at least update-shaped, dispatches to the bot, and always
 * returns a response — including when bot dispatch throws, so a single bad
 * update or transient internal error doesn't surface as a 5xx that would
 * make Telegram retry (and doesn't leak internals either way).
 */
export async function handleWebhookRequest(
  options: HandleWebhookRequestOptions,
): Promise<Response> {
  const { request, webhookSecret, getInitializedBot } = options;

  const providedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!providedSecret || !secureCompare(providedSecret, webhookSecret)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  if (!updateShapeSchema.safeParse(body).success) {
    return Response.json({ ok: false }, { status: 400 });
  }

  try {
    const bot = await getInitializedBot();
    await bot.handleUpdate(body);
  } catch (error) {
    console.error(
      "Telegram webhook: failed to process update",
      error instanceof Error ? error.message : error,
    );
  }

  return Response.json({ ok: true }, { status: 200 });
}
