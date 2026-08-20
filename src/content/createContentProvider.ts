import type { AppEnv } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { GitHubContentProvider } from "./GitHubContentProvider";
import { LocalFilesystemContentProvider } from "./LocalFilesystemContentProvider";
import type { ContentProvider } from "./types";

/**
 * Single composition point for selecting a ContentProvider implementation.
 * Every other layer of the app depends on ContentProvider, never on a
 * concrete provider or on process.env directly.
 */
export function createContentProvider(env: AppEnv = getEnv()): ContentProvider {
  if (env.CONTENT_PROVIDER === "local") {
    if (!env.CONTENT_ROOT) {
      throw new Error("CONTENT_ROOT is required when CONTENT_PROVIDER=local");
    }
    return new LocalFilesystemContentProvider(env.CONTENT_ROOT);
  }

  if (
    !env.GITHUB_OWNER ||
    !env.GITHUB_REPOSITORY ||
    env.GITHUB_CONTENT_PATH === undefined
  ) {
    throw new Error(
      "GITHUB_OWNER, GITHUB_REPOSITORY, and GITHUB_CONTENT_PATH are required when CONTENT_PROVIDER=github",
    );
  }

  return new GitHubContentProvider({
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPOSITORY,
    branch: env.GITHUB_BRANCH,
    contentPath: env.GITHUB_CONTENT_PATH,
    token: env.GITHUB_TOKEN,
  });
}
