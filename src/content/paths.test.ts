import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidPathError } from "./errors";
import {
  isPathWithinRoot,
  normalizeRelativePath,
  parentPath,
  resolveWithinRoot,
} from "./paths";

describe("normalizeRelativePath", () => {
  it("returns the empty string for root", () => {
    expect(normalizeRelativePath("")).toBe("");
  });

  it("accepts simple and nested valid paths unchanged", () => {
    expect(normalizeRelativePath("networking-mastery")).toBe(
      "networking-mastery",
    );
    expect(
      normalizeRelativePath(
        "networking-mastery/03-ip-addressing-and-subnetting.md",
      ),
    ).toBe("networking-mastery/03-ip-addressing-and-subnetting.md");
    expect(
      normalizeRelativePath("networking-mastery/protocols/transport/tcp.md"),
    ).toBe("networking-mastery/protocols/transport/tcp.md");
  });

  it("accepts real-world filename characters (spaces, underscores, mixed case)", () => {
    expect(normalizeRelativePath("SSH Mastery/My Notes_v2.md")).toBe(
      "SSH Mastery/My Notes_v2.md",
    );
  });

  for (const bad of ["..", "../x.md", "x/../y.md", "x/..", "..\\x.md"]) {
    it(`rejects traversal segments: ${JSON.stringify(bad)}`, () => {
      expect(() => normalizeRelativePath(bad)).toThrow(InvalidPathError);
    });
  }

  for (const bad of ["/etc/passwd", "/x.md"]) {
    it(`rejects absolute paths: ${JSON.stringify(bad)}`, () => {
      expect(() => normalizeRelativePath(bad)).toThrow(InvalidPathError);
    });
  }

  for (const bad of ["C:\\x.md", "C:/x.md", "D:\\Windows\\System32"]) {
    it(`rejects drive-letter paths: ${JSON.stringify(bad)}`, () => {
      expect(() => normalizeRelativePath(bad)).toThrow(InvalidPathError);
    });
  }

  it("rejects UNC-style paths", () => {
    expect(() => normalizeRelativePath("\\\\server\\share\\x.md")).toThrow(
      InvalidPathError,
    );
  });

  it("rejects mixed separators", () => {
    expect(() => normalizeRelativePath("networking-mastery\\tcp.md")).toThrow(
      InvalidPathError,
    );
  });

  it("rejects percent-encoded traversal attempts", () => {
    expect(() => normalizeRelativePath("%2e%2e/etc/passwd.md")).toThrow(
      InvalidPathError,
    );
    expect(() => normalizeRelativePath("%2e%2e%2fpasswd.md")).toThrow(
      InvalidPathError,
    );
  });

  it("rejects null bytes", () => {
    expect(() =>
      normalizeRelativePath("networking-mastery/tcp.md\0.txt"),
    ).toThrow(InvalidPathError);
  });

  it("rejects empty segments (double slashes, leading/trailing slash)", () => {
    expect(() => normalizeRelativePath("networking-mastery//tcp.md")).toThrow(
      InvalidPathError,
    );
    expect(() => normalizeRelativePath("networking-mastery/")).toThrow(
      InvalidPathError,
    );
  });

  it("rejects reserved/unsafe filename characters", () => {
    expect(() => normalizeRelativePath("bad<name>.md")).toThrow(
      InvalidPathError,
    );
    expect(() => normalizeRelativePath("bad:name.md")).toThrow(
      InvalidPathError,
    );
    expect(() => normalizeRelativePath("bad|name.md")).toThrow(
      InvalidPathError,
    );
  });
});

describe("isPathWithinRoot", () => {
  it("treats the root itself as within root", () => {
    expect(isPathWithinRoot("/content", "/content")).toBe(true);
  });

  it("treats nested paths as within root", () => {
    expect(isPathWithinRoot("/content", "/content/sub/dir")).toBe(true);
  });

  it("rejects paths outside root", () => {
    expect(isPathWithinRoot("/content", "/other")).toBe(false);
    expect(isPathWithinRoot("/content", "/content-evil")).toBe(false);
  });
});

describe("resolveWithinRoot", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mastery-bot-paths-"));
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub", "doc.md"), "# Doc", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves the root path itself", async () => {
    const resolved = await resolveWithinRoot(root, "");
    expect(path.basename(resolved)).toBe(path.basename(root));
  });

  it("resolves a nested existing path", async () => {
    const resolved = await resolveWithinRoot(root, "sub/doc.md");
    expect(resolved.endsWith(path.join("sub", "doc.md"))).toBe(true);
  });

  it("propagates ENOENT for a missing path", async () => {
    await expect(
      resolveWithinRoot(root, "does-not-exist.md"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlink that escapes the root", async () => {
    const outside = await mkdtemp(
      path.join(os.tmpdir(), "mastery-bot-outside-"),
    );
    try {
      await writeFile(path.join(outside, "secret.md"), "# Secret", "utf8");
      const linkPath = path.join(root, "escape.md");
      try {
        await symlink(path.join(outside, "secret.md"), linkPath, "file");
      } catch {
        // Creating symlinks requires elevated privileges on some Windows
        // configurations; skip this specific assertion when unavailable.
        return;
      }
      await expect(resolveWithinRoot(root, "escape.md")).rejects.toThrow(
        InvalidPathError,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("parentPath", () => {
  it("returns root for root", () => {
    expect(parentPath("")).toBe("");
  });

  it("returns root for a top-level entry", () => {
    expect(parentPath("networking-mastery")).toBe("");
  });

  it("returns the immediate parent for a one-level nested path", () => {
    expect(parentPath("networking-mastery/tcp.md")).toBe("networking-mastery");
  });

  it("returns the immediate parent for a deeply nested path", () => {
    expect(parentPath("networking-mastery/protocols/transport/tcp.md")).toBe(
      "networking-mastery/protocols/transport",
    );
  });
});
