import { describe, expect, it } from "vitest";
import {
  ContentNotFoundError,
  ContentProviderAuthError,
  ContentProviderPermissionError,
  ContentProviderRateLimitedError,
  ContentProviderUnavailableError,
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
