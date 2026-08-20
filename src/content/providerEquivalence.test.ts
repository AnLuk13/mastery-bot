import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitHubContentProvider } from "./GitHubContentProvider";
import { createMockGitHubFetch, dir, file } from "./github/mockGitHubApi";
import { LocalFilesystemContentProvider } from "./LocalFilesystemContentProvider";
import type { ContentProvider } from "./types";

/**
 * Demonstrates that LocalFilesystemContentProvider and GitHubContentProvider
 * satisfy the same application-level contract for equivalent content: same
 * ContentEntry/Document shapes, same paths, same ordering. Implementations
 * differ; the domain-level results they hand to the rest of the app do not.
 */

const CONTENT = {
  "00-index.md": "# Index\nWelcome to the mastery notes.",
  "01-alpha.md": "# Alpha\nDiscusses the TCP handshake.",
  "10-beta.md": "# Beta",
  "GLOSSARY.md": "# Glossary",
} as const;

const NESTED_CONTENT = "# TCP\nNested transport-layer notes.";

describe("LocalFilesystemContentProvider vs GitHubContentProvider equivalence", () => {
  let tempRoot: string;
  let local: ContentProvider;
  let github: ContentProvider;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mastery-bot-equiv-"));
    for (const [name, content] of Object.entries(CONTENT)) {
      await writeFile(path.join(tempRoot, name), content, "utf8");
    }
    await mkdir(path.join(tempRoot, "networking-mastery"));
    await writeFile(
      path.join(tempRoot, "networking-mastery", "03-tcp.md"),
      NESTED_CONTENT,
      "utf8",
    );

    local = new LocalFilesystemContentProvider(tempRoot);

    const githubFixture = dir({
      "00-index.md": file(CONTENT["00-index.md"]),
      "01-alpha.md": file(CONTENT["01-alpha.md"]),
      "10-beta.md": file(CONTENT["10-beta.md"]),
      "GLOSSARY.md": file(CONTENT["GLOSSARY.md"]),
      "networking-mastery": dir({
        "03-tcp.md": file(NESTED_CONTENT),
      }),
    });
    github = new GitHubContentProvider({
      owner: "test-owner",
      repo: "test-repo",
      branch: "main",
      contentPath: "",
      fetchImpl: createMockGitHubFetch(githubFixture),
    });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("produce identical root listings", async () => {
    const [localEntries, githubEntries] = await Promise.all([
      local.listDirectory(""),
      github.listDirectory(""),
    ]);
    expect(githubEntries).toEqual(localEntries);
  });

  it("produce identical nested folder listings", async () => {
    const [localEntries, githubEntries] = await Promise.all([
      local.listDirectory("networking-mastery"),
      github.listDirectory("networking-mastery"),
    ]);
    expect(githubEntries).toEqual(localEntries);
  });

  it("produce identical documents for the same path", async () => {
    const [localDoc, githubDoc] = await Promise.all([
      local.getDocument("networking-mastery/03-tcp.md"),
      github.getDocument("networking-mastery/03-tcp.md"),
    ]);
    expect(githubDoc).toEqual(localDoc);
  });

  it("produce compatible search results for the same query", async () => {
    const [localResults, githubResults] = await Promise.all([
      local.search("tcp"),
      github.search("tcp"),
    ]);

    const normalize = (
      results: Awaited<ReturnType<ContentProvider["search"]>>,
    ) =>
      [...results]
        .map((r) => ({ path: r.path, name: r.name, matchType: r.matchType }))
        .sort((a, b) => a.path.localeCompare(b.path));

    expect(normalize(githubResults)).toEqual(normalize(localResults));
  });

  it("reject the same invalid path identically on both providers", async () => {
    await expect(local.getDocument("../outside.md")).rejects.toThrow();
    await expect(github.getDocument("../outside.md")).rejects.toThrow();
  });
});
