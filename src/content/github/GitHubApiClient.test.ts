import { describe, expect, it } from "vitest";
import {
  ContentNotFoundError,
  ContentProviderAuthError,
  ContentProviderPermissionError,
  ContentProviderRateLimitedError,
  ContentProviderUnavailableError,
  ContentWriteConflictError,
} from "../errors";
import { GitHubApiClient } from "./GitHubApiClient";
import {
  createFailingFetch,
  createMalformedJsonFetch,
  createMockGitHubFetch,
  createStatusFetch,
  dir,
  file,
} from "./mockGitHubApi";

const fixture = dir({
  "00-index.md": file("# Index"),
  "networking-mastery": dir({
    "01-tcp.md": file("# TCP\nDiscusses the handshake."),
    protocols: dir({
      "deep.md": file("# Deep"),
    }),
  }),
});

function makeClient(fetchImpl: typeof fetch, token?: string) {
  return new GitHubApiClient({
    owner: "test-owner",
    repo: "test-repo",
    token,
    fetchImpl,
  });
}

describe("GitHubApiClient.getContents", () => {
  it("lists the root directory", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const result = await client.getContents("", "main", "");
    expect(Array.isArray(result)).toBe(true);
    const names = (result as { name: string }[]).map((e) => e.name).sort();
    expect(names).toEqual(["00-index.md", "networking-mastery"]);
  });

  it("lists a nested directory", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const result = await client.getContents(
      "networking-mastery",
      "main",
      "networking-mastery",
    );
    expect(Array.isArray(result)).toBe(true);
    const names = (result as { name: string }[]).map((e) => e.name).sort();
    expect(names).toEqual(["01-tcp.md", "protocols"]);
  });

  it("retrieves a single file with base64 content", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const result = await client.getContents(
      "networking-mastery/01-tcp.md",
      "main",
      "networking-mastery/01-tcp.md",
    );
    expect(Array.isArray(result)).toBe(false);
    if (!Array.isArray(result)) {
      expect(result.type).toBe("file");
      expect(result.encoding).toBe("base64");
    }
  });

  it("throws ContentNotFoundError for a missing path", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    await expect(
      client.getContents("does-not-exist", "main", "does-not-exist"),
    ).rejects.toThrow(ContentNotFoundError);
  });
});

describe("GitHubApiClient.getFileContent", () => {
  it("decodes base64 content", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const item = await client.getContents(
      "networking-mastery/01-tcp.md",
      "main",
      "x",
    );
    if (Array.isArray(item)) throw new Error("expected file");
    const content = await client.getFileContent(
      item,
      "networking-mastery/01-tcp.md",
    );
    expect(content).toBe("# TCP\nDiscusses the handshake.");
  });
});

describe("GitHubApiClient.getTree", () => {
  it("returns every blob in the repository in one call", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const { entries, truncated } = await client.getTree("main");
    expect(truncated).toBe(false);
    const paths = entries
      .filter((e) => e.type === "blob")
      .map((e) => e.path)
      .sort();
    expect(paths).toEqual([
      "00-index.md",
      "networking-mastery/01-tcp.md",
      "networking-mastery/protocols/deep.md",
    ]);
  });
});

describe("GitHubApiClient.getBlob", () => {
  it("decodes a blob by sha", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const { entries } = await client.getTree("main");
    const target = entries.find(
      (e) => e.path === "networking-mastery/01-tcp.md",
    );
    if (!target) throw new Error("fixture missing entry");
    const content = await client.getBlob(target.sha, target.path);
    expect(content).toBe("# TCP\nDiscusses the handshake.");
  });
});

describe("GitHubApiClient authentication", () => {
  it("sends the bearer token when configured", async () => {
    const fetchImpl = createMockGitHubFetch(fixture, {
      requireToken: "secret-token",
    });
    const client = makeClient(fetchImpl, "secret-token");
    const result = await client.getContents("", "main", "");
    expect(Array.isArray(result)).toBe(true);
  });

  it("fails authentication when no token is configured but one is required", async () => {
    const fetchImpl = createMockGitHubFetch(fixture, {
      requireToken: "secret-token",
    });
    const client = makeClient(fetchImpl);
    await expect(client.getContents("", "main", "")).rejects.toThrow(
      ContentProviderAuthError,
    );
  });
});

describe("GitHubApiClient.getBranchHeadSha", () => {
  it("returns the branch's current commit sha", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const sha = await client.getBranchHeadSha("main");
    expect(sha).toBe("commit-0");
  });

  it("throws ContentNotFoundError for an unknown branch", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    await expect(client.getBranchHeadSha("no-such-branch")).rejects.toThrow(
      ContentNotFoundError,
    );
  });
});

describe("GitHubApiClient.getLatestCommit", () => {
  it("returns undefined when the path has no tracked commit history", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const commit = await client.getLatestCommit(
      "networking-mastery/01-tcp.md",
      "main",
    );
    expect(commit).toBeUndefined();
  });

  it("returns the most recent commit that touched a file", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    await client.createOrUpdateFile(
      "networking-mastery/01-tcp.md",
      "# TCP\nRevised.",
      "save: revise tcp",
      "main",
      "sha:networking-mastery/01-tcp.md",
    );

    const commit = await client.getLatestCommit(
      "networking-mastery/01-tcp.md",
      "main",
    );
    expect(commit?.message).toBe("save: revise tcp");
    expect(commit?.date).toBeTruthy();
  });

  it("returns the most recent commit that touched anything under a directory", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    await client.createOrUpdateFile(
      "networking-mastery/protocols/new.md",
      "# New",
      "add new protocol note",
      "main",
    );

    const commit = await client.getLatestCommit("networking-mastery", "main");
    expect(commit?.message).toBe("add new protocol note");
  });

  it("takes only the first line of a multi-line commit message", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    await client.createOrUpdateFile(
      "networking-mastery/01-tcp.md",
      "# TCP\nRevised.",
      "save: revise tcp\n\nLonger body explaining why.",
      "main",
      "sha:networking-mastery/01-tcp.md",
    );

    const commit = await client.getLatestCommit(
      "networking-mastery/01-tcp.md",
      "main",
    );
    expect(commit?.message).toBe("save: revise tcp");
  });
});

describe("GitHubApiClient write flow", () => {
  it("creates a new file and advances the branch head", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const before = await client.getBranchHeadSha("main");

    const result = await client.createOrUpdateFile(
      "new-topic/note.md",
      "# New note",
      "add note",
      "main",
    );
    expect(result.contentSha).toBe("sha:new-topic/note.md");

    const after = await client.getBranchHeadSha("main");
    expect(after).not.toBe(before);

    const item = await client.getContents(
      "new-topic/note.md",
      "main",
      "new-topic/note.md",
    );
    if (Array.isArray(item)) throw new Error("expected file");
    expect(await client.getFileContent(item, "new-topic/note.md")).toBe(
      "# New note",
    );
  });

  it("updates an existing file when given its current sha", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    await client.createOrUpdateFile(
      "00-index.md",
      "# Updated index",
      "update",
      "main",
      "sha:00-index.md",
    );

    const item = await client.getContents("00-index.md", "main", "00-index.md");
    if (Array.isArray(item)) throw new Error("expected file");
    expect(await client.getFileContent(item, "00-index.md")).toBe(
      "# Updated index",
    );
  });

  it("throws ContentWriteConflictError updating with a stale sha", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    await expect(
      client.createOrUpdateFile(
        "00-index.md",
        "# Updated index",
        "update",
        "main",
        "sha:stale",
      ),
    ).rejects.toThrow(ContentWriteConflictError);
  });

  it("deletes a file given its current sha", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    await client.deleteFile("00-index.md", "sha:00-index.md", "remove", "main");

    await expect(
      client.getContents("00-index.md", "main", "00-index.md"),
    ).rejects.toThrow(ContentNotFoundError);
  });

  it("reads a path as of an older commit after a later write changed it", async () => {
    const client = makeClient(createMockGitHubFetch(fixture));
    const beforeSha = await client.getBranchHeadSha("main");
    await client.createOrUpdateFile(
      "00-index.md",
      "# Updated index",
      "update",
      "main",
      "sha:00-index.md",
    );

    const historical = await client.getContents(
      "00-index.md",
      beforeSha,
      "00-index.md",
    );
    if (Array.isArray(historical)) throw new Error("expected file");
    expect(await client.getFileContent(historical, "00-index.md")).toBe(
      "# Index",
    );

    const current = await client.getContents(
      "00-index.md",
      "main",
      "00-index.md",
    );
    if (Array.isArray(current)) throw new Error("expected file");
    expect(await client.getFileContent(current, "00-index.md")).toBe(
      "# Updated index",
    );
  });
});

describe("GitHubApiClient error mapping", () => {
  it("maps 401 to ContentProviderAuthError", async () => {
    const client = makeClient(createStatusFetch(401));
    await expect(client.getContents("x.md", "main", "x.md")).rejects.toThrow(
      ContentProviderAuthError,
    );
  });

  it("maps a plain 403 to ContentProviderPermissionError", async () => {
    const client = makeClient(createStatusFetch(403));
    await expect(client.getContents("x.md", "main", "x.md")).rejects.toThrow(
      ContentProviderPermissionError,
    );
  });

  it("maps a rate-limited 403 (x-ratelimit-remaining: 0) to ContentProviderRateLimitedError", async () => {
    const client = makeClient(
      createStatusFetch(403, { "x-ratelimit-remaining": "0" }),
    );
    await expect(client.getContents("x.md", "main", "x.md")).rejects.toThrow(
      ContentProviderRateLimitedError,
    );
  });

  it("maps 429 to ContentProviderRateLimitedError with retryAfterSeconds", async () => {
    const client = makeClient(createStatusFetch(429, { "retry-after": "30" }));
    await expect(
      client.getContents("x.md", "main", "x.md"),
    ).rejects.toMatchObject({
      name: "ContentProviderRateLimitedError",
      retryAfterSeconds: 30,
    });
  });

  it("maps 404 to ContentNotFoundError carrying the application path", async () => {
    const client = makeClient(createStatusFetch(404));
    await expect(
      client.getContents("missing.md", "main", "networking-mastery/missing.md"),
    ).rejects.toMatchObject({
      name: "ContentNotFoundError",
      path: "networking-mastery/missing.md",
    });
  });

  it("maps 500 to ContentProviderUnavailableError", async () => {
    const client = makeClient(createStatusFetch(500));
    await expect(client.getContents("x.md", "main", "x.md")).rejects.toThrow(
      ContentProviderUnavailableError,
    );
  });

  it("maps a network failure to ContentProviderUnavailableError", async () => {
    const client = makeClient(createFailingFetch());
    await expect(client.getContents("x.md", "main", "x.md")).rejects.toThrow(
      ContentProviderUnavailableError,
    );
  });

  it("maps a malformed (non-JSON) response to ContentProviderUnavailableError", async () => {
    const client = makeClient(createMalformedJsonFetch());
    await expect(client.getContents("x.md", "main", "x.md")).rejects.toThrow(
      ContentProviderUnavailableError,
    );
  });

  it("maps a well-formed-but-wrong-shape response to ContentProviderUnavailableError", async () => {
    const badFetch = (async () =>
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const client = makeClient(badFetch);
    await expect(client.getContents("x.md", "main", "x.md")).rejects.toThrow(
      ContentProviderUnavailableError,
    );
  });
});
