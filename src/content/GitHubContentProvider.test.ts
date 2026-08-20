import { describe, expect, it, vi } from "vitest";
import {
  ContentNotFoundError,
  ContentProviderAuthError,
  ContentProviderPermissionError,
  ContentProviderRateLimitedError,
  ContentProviderUnavailableError,
  InvalidPathError,
} from "./errors";
import { GitHubContentProvider } from "./GitHubContentProvider";
import {
  createMockGitHubFetch,
  createStatusFetch,
  dir,
  file,
} from "./github/mockGitHubApi";

const rootFixture = dir({
  "00-index.md": file("# Index\nWelcome."),
  "01-alpha.md": file("# Alpha\nDiscusses the TCP handshake."),
  "10-beta.md": file("# Beta"),
  "GLOSSARY.md": file("# Glossary"),
  "package.json": file('{"name":"not-markdown"}'),
  ".git": dir({ HEAD: file("ref: refs/heads/main") }),
  "networking-mastery": dir({
    "01-tcp.md": file("# TCP\nMentions TCP explicitly."),
    protocols: dir({
      "deep.md": file("# Deep\nAlso about TCP internals."),
    }),
  }),
});

function makeProvider(fetchImpl: typeof fetch, contentPath = "") {
  return new GitHubContentProvider({
    owner: "test-owner",
    repo: "test-repo",
    branch: "main",
    contentPath,
    fetchImpl,
  });
}

describe("GitHubContentProvider.listDirectory", () => {
  it("lists the root: directories first, natural sort, dotfiles and non-markdown excluded", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    const entries = await provider.listDirectory("");
    expect(entries).toEqual([
      {
        type: "directory",
        name: "networking-mastery",
        path: "networking-mastery",
      },
      { type: "document", name: "00-index.md", path: "00-index.md" },
      { type: "document", name: "01-alpha.md", path: "01-alpha.md" },
      { type: "document", name: "10-beta.md", path: "10-beta.md" },
      { type: "document", name: "GLOSSARY.md", path: "GLOSSARY.md" },
    ]);
  });

  it("lists a nested folder", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    const entries = await provider.listDirectory("networking-mastery");
    expect(entries).toEqual([
      {
        type: "directory",
        name: "protocols",
        path: "networking-mastery/protocols",
      },
      {
        type: "document",
        name: "01-tcp.md",
        path: "networking-mastery/01-tcp.md",
      },
    ]);
  });

  it("lists an arbitrarily deep folder", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    const entries = await provider.listDirectory(
      "networking-mastery/protocols",
    );
    expect(entries).toEqual([
      {
        type: "document",
        name: "deep.md",
        path: "networking-mastery/protocols/deep.md",
      },
    ]);
  });

  it("throws ContentNotFoundError for a missing directory", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    await expect(provider.listDirectory("does-not-exist")).rejects.toThrow(
      ContentNotFoundError,
    );
  });

  it("throws ContentNotFoundError when the path is actually a file", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    await expect(provider.listDirectory("00-index.md")).rejects.toThrow(
      ContentNotFoundError,
    );
  });

  it("rejects path traversal before making any network request", async () => {
    const spy = vi.fn(createMockGitHubFetch(rootFixture));
    const provider = makeProvider(spy);
    await expect(provider.listDirectory("../etc")).rejects.toThrow(
      InvalidPathError,
    );
    await expect(provider.listDirectory("C:\\Windows")).rejects.toThrow(
      InvalidPathError,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("GitHubContentProvider.getDocument", () => {
  it("reads a root-level document", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    const doc = await provider.getDocument("01-alpha.md");
    expect(doc).toEqual({
      path: "01-alpha.md",
      name: "01-alpha.md",
      content: "# Alpha\nDiscusses the TCP handshake.",
    });
  });

  it("reads a nested document", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    const doc = await provider.getDocument(
      "networking-mastery/protocols/deep.md",
    );
    expect(doc.content).toContain("Deep");
  });

  it("throws ContentNotFoundError for a missing document", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    await expect(provider.getDocument("missing.md")).rejects.toThrow(
      ContentNotFoundError,
    );
  });

  it("throws ContentNotFoundError for a non-markdown file", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    await expect(provider.getDocument("package.json")).rejects.toThrow(
      ContentNotFoundError,
    );
  });

  it("throws ContentNotFoundError when the path is actually a directory", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    await expect(provider.getDocument("networking-mastery")).rejects.toThrow(
      ContentNotFoundError,
    );
  });

  it("throws InvalidPathError for a path traversal attempt", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    await expect(provider.getDocument("../outside.md")).rejects.toThrow(
      InvalidPathError,
    );
  });
});

describe("GitHubContentProvider with GITHUB_CONTENT_PATH prefix", () => {
  const repoFixture = dir({
    "README.md": file("# Repo readme, not part of the knowledge base"),
    ".github": dir({ "workflows.yml": file("not markdown") }),
    src: dir({ "index.ts": file("console.log(1)") }),
    mastery: rootFixture,
  });

  it("only exposes content under the configured prefix", async () => {
    const provider = makeProvider(
      createMockGitHubFetch(repoFixture),
      "mastery",
    );
    const entries = await provider.listDirectory("");
    expect(entries.map((e) => e.name)).toEqual([
      "networking-mastery",
      "00-index.md",
      "01-alpha.md",
      "10-beta.md",
      "GLOSSARY.md",
    ]);
  });

  it("resolves nested documents relative to the prefix", async () => {
    const provider = makeProvider(
      createMockGitHubFetch(repoFixture),
      "mastery",
    );
    const doc = await provider.getDocument("networking-mastery/01-tcp.md");
    expect(doc.path).toBe("networking-mastery/01-tcp.md");
    expect(doc.content).toContain("TCP");
  });

  it("cannot see content outside the prefix", async () => {
    const provider = makeProvider(
      createMockGitHubFetch(repoFixture),
      "mastery",
    );
    await expect(provider.getDocument("README.md")).rejects.toThrow(
      ContentNotFoundError,
    );
  });
});

describe("GitHubContentProvider.search", () => {
  it("returns an empty array for a blank query", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    expect(await provider.search("   ")).toEqual([]);
  });

  it("returns an empty array when nothing matches", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    expect(await provider.search("zzz-nonexistent-zzz")).toEqual([]);
  });

  it("matches by filename", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    const results = await provider.search("index");
    expect(results).toContainEqual(
      expect.objectContaining({ path: "00-index.md", matchType: "filename" }),
    );
  });

  it("matches by path", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    const results = await provider.search("networking-mastery");
    const paths = results.map((r) => r.path);
    expect(paths).toContain("networking-mastery/01-tcp.md");
    expect(paths).toContain("networking-mastery/protocols/deep.md");
  });

  it("matches by content, case-insensitively, with a snippet", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    const results = await provider.search("HANDSHAKE");
    const match = results.find((r) => r.path === "01-alpha.md");
    expect(match).toBeDefined();
    expect(match?.matchType).toBe("content");
    expect(match?.snippet?.toLowerCase()).toContain("handshake");
  });

  it("excludes non-markdown and dotfiles from results", async () => {
    const provider = makeProvider(createMockGitHubFetch(rootFixture));
    const results = await provider.search("markdown");
    expect(results.some((r) => r.path === "package.json")).toBe(false);
  });
});

describe("GitHubContentProvider error propagation", () => {
  it("propagates 404 as ContentNotFoundError", async () => {
    const provider = makeProvider(createStatusFetch(404));
    await expect(provider.getDocument("x.md")).rejects.toThrow(
      ContentNotFoundError,
    );
  });

  it("propagates 401 as ContentProviderAuthError", async () => {
    const provider = makeProvider(createStatusFetch(401));
    await expect(provider.listDirectory("")).rejects.toThrow(
      ContentProviderAuthError,
    );
  });

  it("propagates 403 as ContentProviderPermissionError", async () => {
    const provider = makeProvider(createStatusFetch(403));
    await expect(provider.listDirectory("")).rejects.toThrow(
      ContentProviderPermissionError,
    );
  });

  it("propagates 429 as ContentProviderRateLimitedError", async () => {
    const provider = makeProvider(createStatusFetch(429));
    await expect(provider.listDirectory("")).rejects.toThrow(
      ContentProviderRateLimitedError,
    );
  });

  it("propagates 500 as ContentProviderUnavailableError", async () => {
    const provider = makeProvider(createStatusFetch(500));
    await expect(provider.listDirectory("")).rejects.toThrow(
      ContentProviderUnavailableError,
    );
  });
});
