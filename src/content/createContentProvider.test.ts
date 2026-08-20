import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { createContentProvider } from "./createContentProvider";
import { GitHubContentProvider } from "./GitHubContentProvider";
import { LocalFilesystemContentProvider } from "./LocalFilesystemContentProvider";

const baseEnvFields = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  TELEGRAM_SETUP_SECRET: "test-setup-secret",
  ALLOWED_TELEGRAM_USER_IDS: "123",
};

describe("createContentProvider", () => {
  it("creates a LocalFilesystemContentProvider for CONTENT_PROVIDER=local", () => {
    const env = parseEnv({
      ...baseEnvFields,
      CONTENT_PROVIDER: "local",
      CONTENT_ROOT: "C:\\Users\\antonio\\Desktop\\mastery",
    });
    const provider = createContentProvider(env);
    expect(provider).toBeInstanceOf(LocalFilesystemContentProvider);
  });

  it("creates a GitHubContentProvider for CONTENT_PROVIDER=github", () => {
    const env = parseEnv({
      ...baseEnvFields,
      CONTENT_PROVIDER: "github",
      GITHUB_OWNER: "antonio",
      GITHUB_REPOSITORY: "mastery",
      GITHUB_CONTENT_PATH: "",
    });
    const provider = createContentProvider(env);
    expect(provider).toBeInstanceOf(GitHubContentProvider);
  });

  it("both providers satisfy the same ContentProvider surface", () => {
    const localEnv = parseEnv({
      ...baseEnvFields,
      CONTENT_PROVIDER: "local",
      CONTENT_ROOT: "C:\\Users\\antonio\\Desktop\\mastery",
    });
    const githubEnv = parseEnv({
      ...baseEnvFields,
      CONTENT_PROVIDER: "github",
      GITHUB_OWNER: "antonio",
      GITHUB_REPOSITORY: "mastery",
      GITHUB_CONTENT_PATH: "",
    });

    for (const provider of [
      createContentProvider(localEnv),
      createContentProvider(githubEnv),
    ]) {
      expect(typeof provider.listDirectory).toBe("function");
      expect(typeof provider.getDocument).toBe("function");
      expect(typeof provider.search).toBe("function");
    }
  });
});
