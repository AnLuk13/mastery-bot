import { describe, expect, it, vi } from "vitest";
import {
  handleDeleteWebhookRequest,
  handleGetWebhookInfoRequest,
  handleSetCommandsRequest,
  handleSetWebhookRequest,
  type WebhookApi,
} from "./setupHandler";

const SETUP_SECRET = "test-setup-secret";
const WEBHOOK_SECRET = "test-webhook-secret";
const SETUP_URL = "https://mastery-bot.example.com/api/telegram/setup";

function makeRequest(
  method: string,
  options: { secret?: string; body?: unknown; rawBody?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.secret !== undefined) headers["x-setup-secret"] = options.secret;
  const hasBody = options.body !== undefined || options.rawBody !== undefined;
  return new Request(SETUP_URL, {
    method,
    headers,
    body: hasBody
      ? (options.rawBody ?? JSON.stringify(options.body))
      : undefined,
  });
}

function fakeApi(overrides: Partial<WebhookApi> = {}) {
  const setWebhook = vi.fn(overrides.setWebhook ?? (async () => true as const));
  const deleteWebhook = vi.fn(
    overrides.deleteWebhook ?? (async () => true as const),
  );
  const getWebhookInfo = vi.fn(
    overrides.getWebhookInfo ??
      (async () => ({
        url: "",
        has_custom_certificate: false,
        pending_update_count: 0,
      })),
  );
  const setMyCommands = vi.fn(
    overrides.setMyCommands ?? (async () => true as const),
  );
  const api: WebhookApi = {
    setWebhook,
    deleteWebhook,
    getWebhookInfo,
    setMyCommands,
  };
  return { api, setWebhook, deleteWebhook, getWebhookInfo, setMyCommands };
}

describe("handleSetWebhookRequest", () => {
  it("sets the webhook with the configured secret when authorized", async () => {
    const { api, setWebhook } = fakeApi();
    const request = makeRequest("POST", {
      secret: SETUP_SECRET,
      body: { url: "https://mastery-bot.vercel.app/api/telegram/webhook" },
    });

    const response = await handleSetWebhookRequest({
      request,
      setupSecret: SETUP_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(200);
    expect(setWebhook).toHaveBeenCalledWith(
      "https://mastery-bot.vercel.app/api/telegram/webhook",
      {
        secret_token: WEBHOOK_SECRET,
      },
    );
  });

  it("rejects an invalid setup secret and never calls the API", async () => {
    const { api, setWebhook } = fakeApi();
    const request = makeRequest("POST", {
      secret: "wrong",
      body: { url: "https://x.com/webhook" },
    });

    const response = await handleSetWebhookRequest({
      request,
      setupSecret: SETUP_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(401);
    expect(setWebhook).not.toHaveBeenCalled();
  });

  it("rejects a missing setup secret", async () => {
    const { api, setWebhook } = fakeApi();
    const request = makeRequest("POST", {
      body: { url: "https://x.com/webhook" },
    });

    const response = await handleSetWebhookRequest({
      request,
      setupSecret: SETUP_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(401);
    expect(setWebhook).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body", async () => {
    const { api, setWebhook } = fakeApi();
    const request = makeRequest("POST", {
      secret: SETUP_SECRET,
      rawBody: "not json",
    });

    const response = await handleSetWebhookRequest({
      request,
      setupSecret: SETUP_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(400);
    expect(setWebhook).not.toHaveBeenCalled();
  });

  it("rejects a body missing url", async () => {
    const { api, setWebhook } = fakeApi();
    const request = makeRequest("POST", { secret: SETUP_SECRET, body: {} });

    const response = await handleSetWebhookRequest({
      request,
      setupSecret: SETUP_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(400);
    expect(setWebhook).not.toHaveBeenCalled();
  });

  it("rejects a non-https url", async () => {
    const { api, setWebhook } = fakeApi();
    const request = makeRequest("POST", {
      secret: SETUP_SECRET,
      body: { url: "http://insecure.example.com/webhook" },
    });

    const response = await handleSetWebhookRequest({
      request,
      setupSecret: SETUP_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(400);
    expect(setWebhook).not.toHaveBeenCalled();
  });

  it("returns 502 without leaking details when the Telegram API call fails", async () => {
    const { api } = fakeApi({
      setWebhook: async () => {
        throw new Error("Telegram said: bad request, token abc123");
      },
    });
    const request = makeRequest("POST", {
      secret: SETUP_SECRET,
      body: { url: "https://x.com/webhook" },
    });

    const response = await handleSetWebhookRequest({
      request,
      setupSecret: SETUP_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      getApi: () => api,
    });

    const body: unknown = await response.json();
    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("abc123");
  });
});

describe("handleDeleteWebhookRequest", () => {
  it("deletes the webhook when authorized", async () => {
    const { api, deleteWebhook } = fakeApi();
    const request = makeRequest("DELETE", { secret: SETUP_SECRET });

    const response = await handleDeleteWebhookRequest({
      request,
      setupSecret: SETUP_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(200);
    expect(deleteWebhook).toHaveBeenCalledTimes(1);
  });

  it("rejects an unauthorized delete", async () => {
    const { api, deleteWebhook } = fakeApi();
    const request = makeRequest("DELETE", { secret: "wrong" });

    const response = await handleDeleteWebhookRequest({
      request,
      setupSecret: SETUP_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(401);
    expect(deleteWebhook).not.toHaveBeenCalled();
  });
});

describe("handleSetCommandsRequest", () => {
  it("registers BOT_COMMANDS when authorized", async () => {
    const { api, setMyCommands } = fakeApi();
    const request = makeRequest("PUT", { secret: SETUP_SECRET });

    const response = await handleSetCommandsRequest({
      request,
      setupSecret: SETUP_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(200);
    expect(setMyCommands).toHaveBeenCalledTimes(1);
    const [registered] = setMyCommands.mock.calls[0];
    expect(registered.map((c: { command: string }) => c.command)).toEqual([
      "start",
      "search",
      "clear",
    ]);
  });

  it("rejects an unauthorized request and never calls the API", async () => {
    const { api, setMyCommands } = fakeApi();
    const request = makeRequest("PUT", { secret: "wrong" });

    const response = await handleSetCommandsRequest({
      request,
      setupSecret: SETUP_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(401);
    expect(setMyCommands).not.toHaveBeenCalled();
  });

  it("returns 502 without leaking details when the Telegram API call fails", async () => {
    const { api } = fakeApi({
      setMyCommands: async () => {
        throw new Error("Telegram said: bad request, token abc123");
      },
    });
    const request = makeRequest("PUT", { secret: SETUP_SECRET });

    const response = await handleSetCommandsRequest({
      request,
      setupSecret: SETUP_SECRET,
      getApi: () => api,
    });

    const body: unknown = await response.json();
    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("abc123");
  });
});

describe("handleGetWebhookInfoRequest", () => {
  it("returns webhook info when authorized", async () => {
    const { api } = fakeApi({
      getWebhookInfo: async () => ({
        url: "https://x.com/webhook",
        has_custom_certificate: false,
        pending_update_count: 0,
      }),
    });
    const request = makeRequest("GET", { secret: SETUP_SECRET });

    const response = await handleGetWebhookInfoRequest({
      request,
      setupSecret: SETUP_SECRET,
      getApi: () => api,
    });
    const body = (await response.json()) as {
      ok: boolean;
      info: { url: string };
    };

    expect(response.status).toBe(200);
    expect(body.info.url).toBe("https://x.com/webhook");
  });

  it("rejects an unauthorized info request", async () => {
    const { api, getWebhookInfo } = fakeApi();
    const request = makeRequest("GET", {});

    const response = await handleGetWebhookInfoRequest({
      request,
      setupSecret: SETUP_SECRET,
      getApi: () => api,
    });

    expect(response.status).toBe(401);
    expect(getWebhookInfo).not.toHaveBeenCalled();
  });
});
