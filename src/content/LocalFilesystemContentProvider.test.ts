import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentNotFoundError, InvalidPathError } from "./errors";
import { LocalFilesystemContentProvider } from "./LocalFilesystemContentProvider";

async function writeFixture(root: string) {
  await writeFile(
    path.join(root, "00-index.md"),
    "# Index\nWelcome to the mastery notes.",
    "utf8",
  );
  await writeFile(
    path.join(root, "01-alpha.md"),
    "# Alpha\nDiscusses the TCP handshake in detail.",
    "utf8",
  );
  await writeFile(
    path.join(root, "02-gamma.md"),
    "# Gamma\nNothing special here.",
    "utf8",
  );
  await writeFile(
    path.join(root, "10-beta.md"),
    "# Beta\nAnother document.",
    "utf8",
  );
  await writeFile(
    path.join(root, "GLOSSARY.md"),
    "# Glossary\nTerms and definitions.",
    "utf8",
  );
  await writeFile(
    path.join(root, "ignored.txt"),
    "not markdown, must not be exposed",
    "utf8",
  );
  await writeFile(
    path.join(root, "My Notes_v2.md"),
    "# My Notes\nReal-world filename formatting.",
    "utf8",
  );

  await mkdir(path.join(root, ".git"));
  await writeFile(
    path.join(root, ".git", "HEAD"),
    "ref: refs/heads/main",
    "utf8",
  );

  await mkdir(path.join(root, "subfolder"));
  await writeFile(
    path.join(root, "subfolder", "nested.md"),
    "# Nested\nNested document content.",
    "utf8",
  );

  await mkdir(path.join(root, "subfolder", "deeper"));
  await writeFile(
    path.join(root, "subfolder", "deeper", "deep.md"),
    "# Deep\nDeeply nested content also mentions TCP.",
    "utf8",
  );
}

describe("LocalFilesystemContentProvider", () => {
  let root: string;
  let provider: LocalFilesystemContentProvider;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mastery-bot-fixture-"));
    await writeFixture(root);
    provider = new LocalFilesystemContentProvider(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("listDirectory", () => {
    it("lists the root: directories first, files naturally sorted, dotfiles and non-markdown excluded", async () => {
      const entries = await provider.listDirectory("");
      expect(entries).toEqual([
        { type: "directory", name: "subfolder", path: "subfolder" },
        { type: "document", name: "00-index.md", path: "00-index.md" },
        { type: "document", name: "01-alpha.md", path: "01-alpha.md" },
        { type: "document", name: "02-gamma.md", path: "02-gamma.md" },
        { type: "document", name: "10-beta.md", path: "10-beta.md" },
        { type: "document", name: "GLOSSARY.md", path: "GLOSSARY.md" },
        { type: "document", name: "My Notes_v2.md", path: "My Notes_v2.md" },
      ]);
    });

    it("lists a nested subfolder with canonical POSIX paths", async () => {
      const entries = await provider.listDirectory("subfolder");
      expect(entries).toEqual([
        { type: "directory", name: "deeper", path: "subfolder/deeper" },
        { type: "document", name: "nested.md", path: "subfolder/nested.md" },
      ]);
    });

    it("lists an arbitrarily deep nested subfolder", async () => {
      const entries = await provider.listDirectory("subfolder/deeper");
      expect(entries).toEqual([
        { type: "document", name: "deep.md", path: "subfolder/deeper/deep.md" },
      ]);
    });

    it("throws ContentNotFoundError for a missing directory", async () => {
      await expect(provider.listDirectory("does-not-exist")).rejects.toThrow(
        ContentNotFoundError,
      );
    });

    it("throws ContentNotFoundError when the path is actually a file", async () => {
      await expect(provider.listDirectory("00-index.md")).rejects.toThrow(
        ContentNotFoundError,
      );
    });

    it("throws InvalidPathError for a path traversal attempt", async () => {
      await expect(provider.listDirectory("../")).rejects.toThrow(
        InvalidPathError,
      );
      await expect(provider.listDirectory("subfolder/../../")).rejects.toThrow(
        InvalidPathError,
      );
    });

    it("throws InvalidPathError for an absolute or drive-letter path", async () => {
      await expect(provider.listDirectory("/etc")).rejects.toThrow(
        InvalidPathError,
      );
      await expect(provider.listDirectory("C:\\Windows")).rejects.toThrow(
        InvalidPathError,
      );
    });
  });

  describe("getDocument", () => {
    it("reads a root-level document", async () => {
      const doc = await provider.getDocument("01-alpha.md");
      expect(doc).toEqual({
        path: "01-alpha.md",
        name: "01-alpha.md",
        content: "# Alpha\nDiscusses the TCP handshake in detail.",
      });
    });

    it("reads a nested document", async () => {
      const doc = await provider.getDocument("subfolder/deeper/deep.md");
      expect(doc.content).toContain("Deeply nested content");
    });

    it("reads a document with spaces and underscores in its name", async () => {
      const doc = await provider.getDocument("My Notes_v2.md");
      expect(doc.content).toContain("Real-world filename formatting");
    });

    it("throws ContentNotFoundError for a missing document", async () => {
      await expect(provider.getDocument("missing.md")).rejects.toThrow(
        ContentNotFoundError,
      );
    });

    it("throws ContentNotFoundError for a non-markdown file", async () => {
      await expect(provider.getDocument("ignored.txt")).rejects.toThrow(
        ContentNotFoundError,
      );
    });

    it("throws ContentNotFoundError for the root path", async () => {
      await expect(provider.getDocument("")).rejects.toThrow(
        ContentNotFoundError,
      );
    });

    it("throws ContentNotFoundError when the path is actually a directory", async () => {
      await expect(provider.getDocument("subfolder")).rejects.toThrow(
        ContentNotFoundError,
      );
    });

    it("throws InvalidPathError for a path traversal attempt", async () => {
      await expect(provider.getDocument("../outside.md")).rejects.toThrow(
        InvalidPathError,
      );
    });

    it("throws InvalidPathError for a null-byte path", async () => {
      await expect(provider.getDocument("01\0-alpha.md")).rejects.toThrow(
        InvalidPathError,
      );
    });
  });

  describe("symlink handling", () => {
    it("excludes a symlink that escapes the content root from listings", async () => {
      const outside = await mkdtemp(
        path.join(os.tmpdir(), "mastery-bot-outside-"),
      );
      try {
        await writeFile(path.join(outside, "secret.md"), "# Secret", "utf8");
        try {
          await symlink(
            path.join(outside, "secret.md"),
            path.join(root, "escape.md"),
            "file",
          );
        } catch {
          return;
        }
        const entries = await provider.listDirectory("");
        expect(entries.some((e) => e.name === "escape.md")).toBe(false);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  describe("search", () => {
    it("returns an empty array for a blank query", async () => {
      expect(await provider.search("   ")).toEqual([]);
    });

    it("returns an empty array when nothing matches", async () => {
      expect(await provider.search("nonexistent-zzz-topic")).toEqual([]);
    });

    it("matches by filename", async () => {
      const results = await provider.search("index");
      expect(results).toContainEqual(
        expect.objectContaining({ path: "00-index.md", matchType: "filename" }),
      );
    });

    it("matches by path for nested documents", async () => {
      const results = await provider.search("subfolder");
      const paths = results.map((r) => r.path);
      expect(paths).toContain("subfolder/nested.md");
      expect(paths).toContain("subfolder/deeper/deep.md");
    });

    it("matches by content, case-insensitively, and includes a snippet", async () => {
      const results = await provider.search("TCP");
      const alpha = results.find((r) => r.path === "01-alpha.md");
      const deep = results.find((r) => r.path === "subfolder/deeper/deep.md");
      expect(alpha).toBeDefined();
      expect(alpha?.matchType).toBe("content");
      expect(alpha?.snippet?.toLowerCase()).toContain("tcp");
      expect(deep).toBeDefined();
    });

    it("does not include non-markdown files in results", async () => {
      const results = await provider.search("markdown");
      expect(results.some((r) => r.path === "ignored.txt")).toBe(false);
    });
  });
});
