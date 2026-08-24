import { Bot } from "grammy";
import { describe, expect, it } from "vitest";
import { GroqClient } from "@/rag/groqClient";
import type { AnswerQuestionDeps } from "@/rag/answerQuestion";
import {
  createFakeAllowedUsersStore,
  createFakeContentProvider,
  createFakeContentWriter,
  createFakeSessionStore,
} from "./testHelpers";
import { createBot } from "./bot";

const fakeAskDeps: AnswerQuestionDeps = {
  embed: async () => [],
  index: { model: "test-model", dimensions: 0, chunks: [] },
  groq: new GroqClient({ apiKey: "test-key", model: "test-model" }),
  privateFolders: [],
};

/**
 * grammY's Context/Api types make a fully offline handleUpdate() dispatch
 * test require either real network calls or generically-typed transformer
 * mocks that would need unsafe casts to satisfy TypeScript across every
 * method grammY exposes. Since every actual decision this module makes
 * (auth check, callback decoding, dispatch target) is already covered by
 * pure unit tests against the handlers/keyboards/callbackData directly, this
 * suite stays a construction/wiring smoke test — real end-to-end dispatch
 * gets exercised via the webhook route in Stage 7, where we already have a
 * concrete Update payload to send through.
 */
describe("createBot", () => {
  it("constructs a Bot wired with the configured token and botInfo, without hitting the network", () => {
    const fakeBotInfo = {
      id: 1,
      is_bot: true as const,
      first_name: "Mastery Bot",
      username: "mastery_test_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    };

    const bot = createBot({
      token: "test-token",
      contentProvider: createFakeContentProvider(),
      allowedUserIds: [1],
      askDeps: fakeAskDeps,
      saveGroq: new GroqClient({ apiKey: "test-key", model: "test-model" }),
      editors: [],
      contentWriter: createFakeContentWriter().writer,
      privateFolders: [],
      sessionStore: createFakeSessionStore(),
      adminIds: [],
      allowedUsersStore: createFakeAllowedUsersStore(),
      botInfo: fakeBotInfo,
    });

    expect(bot).toBeInstanceOf(Bot);
    expect(bot.isInited()).toBe(true);
    expect(bot.botInfo).toEqual(fakeBotInfo);
  });
});
