import { describe, expect, it } from "vitest";
import { GitHubContentProvider } from "./GitHubContentProvider";

/**
 * Read-only sanity check against a real GitHub repository, entirely opt-in:
 * set MASTERY_GITHUB_OWNER / MASTERY_GITHUB_REPOSITORY (and optionally
 * MASTERY_GITHUB_BRANCH, MASTERY_GITHUB_CONTENT_PATH, MASTERY_GITHUB_TOKEN)
 * in the environment before running `npm test` to exercise it. Never commit
 * those values — this test skips itself (not fails) when they're absent,
 * which is the normal state until the mastery repository exists on GitHub.
 */
const owner = process.env.MASTERY_GITHUB_OWNER;
const repo = process.env.MASTERY_GITHUB_REPOSITORY;
const hasRealRepo = Boolean(owner && repo);

describe.skipIf(!hasRealRepo)(
  "GitHubContentProvider (integration: real GitHub repository)",
  () => {
    const provider = new GitHubContentProvider({
      owner: owner ?? "",
      repo: repo ?? "",
      branch: process.env.MASTERY_GITHUB_BRANCH ?? "main",
      contentPath: process.env.MASTERY_GITHUB_CONTENT_PATH ?? "",
      token: process.env.MASTERY_GITHUB_TOKEN,
    });

    it("lists the real repository content root", async () => {
      const entries = await provider.listDirectory("");
      expect(entries.length).toBeGreaterThan(0);
    });

    it("navigates into a discovered folder and reads a document end-to-end", async () => {
      const root = await provider.listDirectory("");
      const folder = root.find((entry) => entry.type === "directory");
      if (!folder) return;

      const children = await provider.listDirectory(folder.path);
      const document = children.find((entry) => entry.type === "document");
      if (!document) return;

      const opened = await provider.getDocument(document.path);
      expect(opened.content.length).toBeGreaterThan(0);
    });
  },
);
