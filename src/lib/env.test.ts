import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const baseValidLocalEnv = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  TELEGRAM_SETUP_SECRET: "test-setup-secret",
  ALLOWED_TELEGRAM_USER_IDS: "123,456",
  CONTENT_PROVIDER: "local",
  CONTENT_ROOT: "C:\\Users\\antonio\\Desktop\\mastery",
  GROQ_API_KEY: "test-groq-key",
} satisfies Record<string, string>;

const baseValidGithubEnv = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  TELEGRAM_SETUP_SECRET: "test-setup-secret",
  ALLOWED_TELEGRAM_USER_IDS: "123",
  CONTENT_PROVIDER: "github",
  GITHUB_OWNER: "antonio",
  GITHUB_REPOSITORY: "mastery",
  GITHUB_CONTENT_PATH: "",
  GROQ_API_KEY: "test-groq-key",
} satisfies Record<string, string>;

describe("parseEnv", () => {
  it("accepts a valid local configuration", () => {
    const env = parseEnv(baseValidLocalEnv);
    expect(env.CONTENT_PROVIDER).toBe("local");
    expect(env.ALLOWED_TELEGRAM_USER_IDS).toEqual([123, 456]);
    expect(env.GITHUB_BRANCH).toBe("main");
  });

  it("accepts a valid github configuration with an empty content path", () => {
    const env = parseEnv(baseValidGithubEnv);
    expect(env.CONTENT_PROVIDER).toBe("github");
    expect(env.GITHUB_OWNER).toBe("antonio");
  });

  it("rejects local provider missing CONTENT_ROOT", () => {
    const { CONTENT_ROOT, ...rest } = baseValidLocalEnv;
    expect(() => parseEnv(rest)).toThrowError(/CONTENT_ROOT/);
  });

  it("rejects github provider missing GITHUB_OWNER and GITHUB_REPOSITORY", () => {
    const { GITHUB_OWNER, GITHUB_REPOSITORY, ...rest } = baseValidGithubEnv;
    expect(() => parseEnv(rest)).toThrowError(/GITHUB_OWNER/);
  });

  it("rejects a non-numeric allowed user id", () => {
    expect(() =>
      parseEnv({ ...baseValidLocalEnv, ALLOWED_TELEGRAM_USER_IDS: "123,abc" }),
    ).toThrowError(/numeric Telegram user id/);
  });

  it("rejects an unknown CONTENT_PROVIDER value", () => {
    expect(() =>
      parseEnv({ ...baseValidLocalEnv, CONTENT_PROVIDER: "s3" }),
    ).toThrowError();
  });

  it("rejects a missing TELEGRAM_BOT_TOKEN", () => {
    const { TELEGRAM_BOT_TOKEN, ...rest } = baseValidLocalEnv;
    expect(() => parseEnv(rest)).toThrowError(/TELEGRAM_BOT_TOKEN/);
  });

  it("rejects a missing GROQ_API_KEY", () => {
    const { GROQ_API_KEY, ...rest } = baseValidLocalEnv;
    expect(() => parseEnv(rest)).toThrowError(/GROQ_API_KEY/);
  });

  it("defaults GROQ_MODEL when not set", () => {
    const env = parseEnv(baseValidLocalEnv);
    expect(env.GROQ_MODEL).toBe("openai/gpt-oss-120b");
  });

  it("defaults EDITORS to an empty array when not set", () => {
    const env = parseEnv(baseValidLocalEnv);
    expect(env.EDITORS).toEqual([]);
  });

  it("parses EDITORS into user id / folder pairs", () => {
    const env = parseEnv({
      ...baseValidLocalEnv,
      EDITORS: "712059530:antonio, 111:bob",
      GITHUB_OWNER: "antonio",
      GITHUB_REPOSITORY: "mastery",
      GITHUB_TOKEN: "test-token",
    });
    expect(env.EDITORS).toEqual([
      { userId: 712059530, folder: "antonio" },
      { userId: 111, folder: "bob" },
    ]);
  });

  it("rejects an EDITORS entry missing the folder", () => {
    expect(() =>
      parseEnv({ ...baseValidLocalEnv, EDITORS: "712059530" }),
    ).toThrowError(/<telegram-user-id>:<folder-name>/);
  });

  it("rejects an EDITORS folder that isn't a single safe path segment", () => {
    expect(() =>
      parseEnv({ ...baseValidLocalEnv, EDITORS: "712059530:a/b" }),
    ).toThrowError(/single folder name/);
    expect(() =>
      parseEnv({ ...baseValidLocalEnv, EDITORS: "712059530:.." }),
    ).toThrowError();
  });

  it("requires GitHub write config when EDITORS is set, even with CONTENT_PROVIDER=local", () => {
    expect(() =>
      parseEnv({
        ...baseValidLocalEnv,
        EDITORS: "712059530:antonio",
      }),
    ).toThrowError(/GITHUB_OWNER/);
  });

  it("accepts EDITORS alongside CONTENT_PROVIDER=local when GitHub write config is present", () => {
    const env = parseEnv({
      ...baseValidLocalEnv,
      EDITORS: "712059530:antonio",
      GITHUB_OWNER: "antonio",
      GITHUB_REPOSITORY: "mastery",
      GITHUB_TOKEN: "test-token",
    });
    expect(env.EDITORS).toEqual([{ userId: 712059530, folder: "antonio" }]);
  });
});
