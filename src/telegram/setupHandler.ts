import { z } from "zod";
import { secureCompare } from "@/lib/secureCompare";

/** Only what the setup handlers actually call; a real grammY `Api` satisfies this structurally. */
export interface WebhookApi {
  setWebhook(url: string, other?: { secret_token?: string }): Promise<true>;
  deleteWebhook(): Promise<true>;
  getWebhookInfo(): Promise<unknown>;
}

export interface SetupRequestOptions {
  request: Request;
  setupSecret: string;
  getApi: () => WebhookApi;
}

function isAuthorizedSetupRequest(
  request: Request,
  setupSecret: string,
): boolean {
  const provided = request.headers.get("x-setup-secret");
  return provided !== null && secureCompare(provided, setupSecret);
}

const setWebhookBodySchema = z.object({ url: z.string().url() });

export interface HandleSetWebhookOptions extends SetupRequestOptions {
  webhookSecret: string;
}

/** POST: sets Telegram's webhook to an operator-supplied URL, configured with our webhook secret. */
export async function handleSetWebhookRequest(
  options: HandleSetWebhookOptions,
): Promise<Response> {
  const { request, setupSecret, webhookSecret, getApi } = options;
  if (!isAuthorizedSetupRequest(request, setupSecret)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = setWebhookBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Expected a JSON body: { url: string }" },
      { status: 400 },
    );
  }
  if (!parsed.data.url.startsWith("https://")) {
    return Response.json(
      { ok: false, error: "url must be an https:// URL" },
      { status: 400 },
    );
  }

  try {
    await getApi().setWebhook(parsed.data.url, { secret_token: webhookSecret });
  } catch (error) {
    console.error(
      "Telegram setup: setWebhook failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ ok: false }, { status: 502 });
  }

  return Response.json({ ok: true });
}

/** DELETE: removes Telegram's webhook (e.g. before switching back to local polling for development). */
export async function handleDeleteWebhookRequest(
  options: SetupRequestOptions,
): Promise<Response> {
  const { request, setupSecret, getApi } = options;
  if (!isAuthorizedSetupRequest(request, setupSecret)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    await getApi().deleteWebhook();
  } catch (error) {
    console.error(
      "Telegram setup: deleteWebhook failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ ok: false }, { status: 502 });
  }

  return Response.json({ ok: true });
}

/** GET: reports current webhook configuration for verification. Telegram's WebhookInfo never includes the secret token. */
export async function handleGetWebhookInfoRequest(
  options: SetupRequestOptions,
): Promise<Response> {
  const { request, setupSecret, getApi } = options;
  if (!isAuthorizedSetupRequest(request, setupSecret)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const info = await getApi().getWebhookInfo();
    return Response.json({ ok: true, info });
  } catch (error) {
    console.error(
      "Telegram setup: getWebhookInfo failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ ok: false }, { status: 502 });
  }
}
