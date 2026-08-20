import { describe, expect, it, vi } from "vitest";
import { handleWebhookRequest, type UpdateHandler } from "./webhookHandler";

const WEBHOOK_SECRET = "test-webhook-secret";
const WEBHOOK_URL = "https://mastery-bot.example.com/api/telegram/webhook";

function makeRequest(
  body: unknown,
  options: { secret?: string; rawBody?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.secret !== undefined)
    headers["x-telegram-bot-api-secret-token"] = options.secret;
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  });
}

function fakeBot(overrides: Partial<UpdateHandler> = {}): {
  bot: UpdateHandler;
  handleUpdate: ReturnType<typeof vi.fn>;
} {
  const handleUpdate = vi.fn(overrides.handleUpdate ?? (async () => {}));
  return { bot: { handleUpdate }, handleUpdate };
}

describe("handleWebhookRequest", () => {
  it("processes a valid update with a valid secret and returns 200", async () => {
    const { bot, handleUpdate } = fakeBot();
    const update = { update_id: 1, message: { text: "/start" } };
    const request = makeRequest(update, { secret: WEBHOOK_SECRET });

    const response = await handleWebhookRequest({
      request,
      webhookSecret: WEBHOOK_SECRET,
      getInitializedBot: async () => bot,
    });

    expect(response.status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledTimes(1);
    expect(handleUpdate).toHaveBeenCalledWith(update);
  });

  it("rejects a request with an invalid secret and never dispatches", async () => {
    const { bot, handleUpdate } = fakeBot();
    const request = makeRequest({ update_id: 1 }, { secret: "wrong-secret" });

    const response = await handleWebhookRequest({
      request,
      webhookSecret: WEBHOOK_SECRET,
      getInitializedBot: async () => bot,
    });

    expect(response.status).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("rejects a request with a missing secret header", async () => {
    const { bot, handleUpdate } = fakeBot();
    const request = makeRequest({ update_id: 1 });

    const response = await handleWebhookRequest({
      request,
      webhookSecret: WEBHOOK_SECRET,
      getInitializedBot: async () => bot,
    });

    expect(response.status).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("rejects malformed (non-JSON) request bodies with 400", async () => {
    const { bot, handleUpdate } = fakeBot();
    const request = makeRequest(undefined, {
      secret: WEBHOOK_SECRET,
      rawBody: "not json at all",
    });

    const response = await handleWebhookRequest({
      request,
      webhookSecret: WEBHOOK_SECRET,
      getInitializedBot: async () => bot,
    });

    expect(response.status).toBe(400);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("rejects a well-formed JSON body that isn't update-shaped (missing update_id)", async () => {
    const { bot, handleUpdate } = fakeBot();
    const request = makeRequest({ hello: "world" }, { secret: WEBHOOK_SECRET });

    const response = await handleWebhookRequest({
      request,
      webhookSecret: WEBHOOK_SECRET,
      getInitializedBot: async () => bot,
    });

    expect(response.status).toBe(400);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("dispatches an update from an authorized user through unchanged", async () => {
    const { bot, handleUpdate } = fakeBot();
    const update = {
      update_id: 2,
      message: { from: { id: 123 }, text: "/start" },
    };
    const request = makeRequest(update, { secret: WEBHOOK_SECRET });

    await handleWebhookRequest({
      request,
      webhookSecret: WEBHOOK_SECRET,
      getInitializedBot: async () => bot,
    });

    expect(handleUpdate).toHaveBeenCalledWith(update);
  });

  it("dispatches an update from an unauthorized user through unchanged (per-user auth is the bot's job, not the webhook's)", async () => {
    const { bot, handleUpdate } = fakeBot();
    const update = {
      update_id: 3,
      message: { from: { id: 999 }, text: "/start" },
    };
    const request = makeRequest(update, { secret: WEBHOOK_SECRET });

    const response = await handleWebhookRequest({
      request,
      webhookSecret: WEBHOOK_SECRET,
      getInitializedBot: async () => bot,
    });

    // The webhook layer never inspects who the message is from — it just validates
    // the shared secret and dispatches. enforceAuthorization (tested separately)
    // handles per-user denial inside the bot, and does so without throwing.
    expect(response.status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledWith(update);
  });

  it("still returns 200 when the bot throws while processing (an unexpected internal failure)", async () => {
    const { bot } = fakeBot({
      handleUpdate: async () => {
        throw new Error("simulated content provider outage");
      },
    });
    const request = makeRequest({ update_id: 4 }, { secret: WEBHOOK_SECRET });

    const response = await handleWebhookRequest({
      request,
      webhookSecret: WEBHOOK_SECRET,
      getInitializedBot: async () => bot,
    });

    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(
      "simulated content provider outage",
    );
  });

  it("still returns 200 when getInitializedBot itself throws", async () => {
    const request = makeRequest({ update_id: 5 }, { secret: WEBHOOK_SECRET });

    const response = await handleWebhookRequest({
      request,
      webhookSecret: WEBHOOK_SECRET,
      getInitializedBot: async () => {
        throw new Error("bot init failed");
      },
    });

    expect(response.status).toBe(200);
  });
});
