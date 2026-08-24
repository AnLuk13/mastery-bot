import { describe, expect, it } from "vitest";
import { InvalidPathError } from "./errors";
import { GitHubContentProvider } from "./GitHubContentProvider";
import { GitHubContentWriter } from "./GitHubContentWriter";
import { createMockGitHubFetch, dir, file } from "./github/mockGitHubApi";

const fixture = dir({
  antonio: dir({
    networking: dir({
      "dns.md": file("# DNS\nOriginal content."),
    }),
  }),
});

function makeWriter(
  fetchImpl: typeof fetch,
  contentPath = "",
  onContentChanged?: () => void,
) {
  return new GitHubContentWriter({
    owner: "test-owner",
    repo: "test-repo",
    branch: "main",
    contentPath,
    fetchImpl,
    onContentChanged,
  });
}

function makeReader(fetchImpl: typeof fetch, contentPath = "") {
  return new GitHubContentProvider({
    owner: "test-owner",
    repo: "test-repo",
    branch: "main",
    contentPath,
    fetchImpl,
  });
}

describe("GitHubContentWriter.write", () => {
  it("creates a new file and returns the pre-write HEAD sha", async () => {
    const fetchImpl = createMockGitHubFetch(fixture);
    const writer = makeWriter(fetchImpl);

    const result = await writer.write(
      "antonio/networking/new-note.md",
      "# New note",
      "save: new note",
    );
    expect(result.path).toBe("antonio/networking/new-note.md");
    expect(result.beforeCommitSha).toBe("commit-0");

    const doc = await makeReader(fetchImpl).getDocument(
      "antonio/networking/new-note.md",
    );
    expect(doc.content).toBe("# New note");
  });

  it("updates an existing file", async () => {
    const fetchImpl = createMockGitHubFetch(fixture);
    const writer = makeWriter(fetchImpl);

    await writer.write(
      "antonio/networking/dns.md",
      "# DNS\nRevised.",
      "save: revise dns",
    );

    const doc = await makeReader(fetchImpl).getDocument(
      "antonio/networking/dns.md",
    );
    expect(doc.content).toBe("# DNS\nRevised.");
  });

  it("rejects a non-document path", async () => {
    const writer = makeWriter(createMockGitHubFetch(fixture));
    await expect(
      writer.write("antonio/networking", "content", "message"),
    ).rejects.toThrow(InvalidPathError);
  });

  it("respects a configured content path prefix", async () => {
    const nested = dir({ mastery: fixture });
    const fetchImpl = createMockGitHubFetch(nested);
    const writer = makeWriter(fetchImpl, "mastery");

    const result = await writer.write(
      "antonio/networking/prefixed.md",
      "# Prefixed",
      "save",
    );
    expect(result.path).toBe("antonio/networking/prefixed.md");

    const doc = await makeReader(fetchImpl, "mastery").getDocument(
      "antonio/networking/prefixed.md",
    );
    expect(doc.content).toBe("# Prefixed");
  });
});

describe("GitHubContentWriter.delete", () => {
  it("deletes an existing file and returns the pre-delete HEAD sha", async () => {
    const fetchImpl = createMockGitHubFetch(fixture);
    const writer = makeWriter(fetchImpl);

    const result = await writer.delete(
      "antonio/networking/dns.md",
      "reorganize: remove old copy",
    );
    expect(result.path).toBe("antonio/networking/dns.md");
    expect(result.beforeCommitSha).toBe("commit-0");

    await expect(
      makeReader(fetchImpl).getDocument("antonio/networking/dns.md"),
    ).rejects.toThrow();
  });

  it("is undoable via the existing generic revert()", async () => {
    const fetchImpl = createMockGitHubFetch(fixture);
    const writer = makeWriter(fetchImpl);

    const { beforeCommitSha } = await writer.delete(
      "antonio/networking/dns.md",
      "reorganize: remove old copy",
    );
    await writer.revert(
      "antonio/networking/dns.md",
      beforeCommitSha,
      "revert: undo delete",
    );

    const doc = await makeReader(fetchImpl).getDocument(
      "antonio/networking/dns.md",
    );
    expect(doc.content).toBe("# DNS\nOriginal content.");
  });

  it("rejects a non-document path", async () => {
    const writer = makeWriter(createMockGitHubFetch(fixture));
    await expect(
      writer.delete("antonio/networking", "message"),
    ).rejects.toThrow(InvalidPathError);
  });
});

describe("GitHubContentWriter.revert", () => {
  it("restores the previous content when the file was updated", async () => {
    const fetchImpl = createMockGitHubFetch(fixture);
    const writer = makeWriter(fetchImpl);

    const { beforeCommitSha } = await writer.write(
      "antonio/networking/dns.md",
      "# DNS\nBad edit.",
      "save: bad edit",
    );
    await writer.revert(
      "antonio/networking/dns.md",
      beforeCommitSha,
      "revert: bad edit",
    );

    const doc = await makeReader(fetchImpl).getDocument(
      "antonio/networking/dns.md",
    );
    expect(doc.content).toBe("# DNS\nOriginal content.");
  });

  it("deletes the file when it was newly created", async () => {
    const fetchImpl = createMockGitHubFetch(fixture);
    const writer = makeWriter(fetchImpl);

    const { beforeCommitSha } = await writer.write(
      "antonio/networking/new-note.md",
      "# New note",
      "save: new note",
    );
    await writer.revert(
      "antonio/networking/new-note.md",
      beforeCommitSha,
      "revert: new note",
    );

    await expect(
      makeReader(fetchImpl).getDocument("antonio/networking/new-note.md"),
    ).rejects.toThrow();
  });

  it("is a no-op when the file is already gone", async () => {
    const writer = makeWriter(createMockGitHubFetch(fixture));
    await expect(
      writer.revert("antonio/networking/never-existed.md", "commit-0", "noop"),
    ).resolves.toBeUndefined();
  });
});

describe("GitHubContentWriter onContentChanged", () => {
  it("calls it after a successful write", async () => {
    let calls = 0;
    const writer = makeWriter(createMockGitHubFetch(fixture), "", () => {
      calls++;
    });
    await writer.write("antonio/networking/new-note.md", "content", "save");
    expect(calls).toBe(1);
  });

  it("calls it after a successful delete", async () => {
    let calls = 0;
    const writer = makeWriter(createMockGitHubFetch(fixture), "", () => {
      calls++;
    });
    await writer.delete("antonio/networking/dns.md", "delete");
    expect(calls).toBe(1);
  });

  it("calls it after a revert that restores content", async () => {
    let calls = 0;
    const fetchImpl = createMockGitHubFetch(fixture);
    const writer = makeWriter(fetchImpl, "", () => {
      calls++;
    });
    const { beforeCommitSha } = await writer.write(
      "antonio/networking/dns.md",
      "edited",
      "save",
    );
    expect(calls).toBe(1);
    await writer.revert("antonio/networking/dns.md", beforeCommitSha, "undo");
    expect(calls).toBe(2);
  });

  it("does not call it when revert is a no-op (nothing to restore)", async () => {
    let calls = 0;
    const writer = makeWriter(createMockGitHubFetch(fixture), "", () => {
      calls++;
    });
    await writer.revert(
      "antonio/networking/never-existed.md",
      "commit-0",
      "noop",
    );
    expect(calls).toBe(0);
  });

  it("does not call it when the write is rejected before touching GitHub", async () => {
    let calls = 0;
    const writer = makeWriter(createMockGitHubFetch(fixture), "", () => {
      calls++;
    });
    await expect(
      writer.write("antonio/networking", "content", "message"),
    ).rejects.toThrow(InvalidPathError);
    expect(calls).toBe(0);
  });
});
