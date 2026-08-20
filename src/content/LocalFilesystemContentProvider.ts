import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { ContentNotFoundError } from "./errors";
import { hasMarkdownExtension } from "./markdown";
import {
  isPathWithinRoot,
  joinCanonical,
  normalizeRelativePath,
  resolveWithinRoot,
} from "./paths";
import { buildSnippet } from "./snippet";
import { compareContentEntries } from "./sort";
import type {
  ContentEntry,
  ContentProvider,
  Document,
  SearchResult,
} from "./types";

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export class LocalFilesystemContentProvider implements ContentProvider {
  constructor(private readonly root: string) {}

  async listDirectory(inputPath: string): Promise<ContentEntry[]> {
    const canonical = normalizeRelativePath(inputPath);
    const absolute = await this.resolveExisting(canonical);
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) {
      throw new ContentNotFoundError(canonical);
    }

    const realRoot = await fs.realpath(this.root);
    const dirents = await fs.readdir(absolute, { withFileTypes: true });

    const entries: ContentEntry[] = [];
    for (const dirent of dirents) {
      const kind = await this.classify(dirent, absolute, realRoot);
      if (kind === null) continue;

      const entryPath = joinCanonical(canonical, dirent.name);
      entries.push({ type: kind, name: dirent.name, path: entryPath });
    }

    entries.sort(compareContentEntries);
    return entries;
  }

  async getDocument(inputPath: string): Promise<Document> {
    if (inputPath === "" || !hasMarkdownExtension(inputPath)) {
      throw new ContentNotFoundError(inputPath);
    }

    const absolute = await this.resolveExisting(inputPath);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) {
      throw new ContentNotFoundError(inputPath);
    }

    const content = await fs.readFile(absolute, "utf8");
    return { path: inputPath, name: path.posix.basename(inputPath), content };
  }

  async search(query: string): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery === "") return [];
    const lowerQuery = trimmedQuery.toLowerCase();

    const results: SearchResult[] = [];
    await this.walk("", async (entry) => {
      if (entry.type !== "document") return;

      if (entry.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          path: entry.path,
          name: entry.name,
          matchType: "filename",
        });
        return;
      }
      if (entry.path.toLowerCase().includes(lowerQuery)) {
        results.push({ path: entry.path, name: entry.name, matchType: "path" });
        return;
      }

      const absolute = await this.resolveExisting(entry.path);
      const content = await fs.readFile(absolute, "utf8");
      const matchIndex = content.toLowerCase().indexOf(lowerQuery);
      if (matchIndex !== -1) {
        results.push({
          path: entry.path,
          name: entry.name,
          matchType: "content",
          snippet: buildSnippet(content, matchIndex, trimmedQuery.length),
        });
      }
    });

    return results;
  }

  private async resolveExisting(inputPath: string): Promise<string> {
    try {
      return await resolveWithinRoot(this.root, inputPath);
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        throw new ContentNotFoundError(inputPath);
      }
      throw error;
    }
  }

  private async classify(
    dirent: Dirent,
    parentAbsolute: string,
    realRoot: string,
  ): Promise<"directory" | "document" | null> {
    if (dirent.name.startsWith(".")) return null;

    const absoluteEntryPath = path.join(parentAbsolute, dirent.name);

    if (dirent.isSymbolicLink()) {
      let real: string;
      try {
        real = await fs.realpath(absoluteEntryPath);
      } catch {
        return null;
      }
      if (!isPathWithinRoot(realRoot, real)) return null;

      try {
        const target = await fs.stat(real);
        if (target.isDirectory()) return "directory";
        if (target.isFile() && hasMarkdownExtension(dirent.name))
          return "document";
      } catch {
        return null;
      }
      return null;
    }

    if (dirent.isDirectory()) return "directory";
    if (dirent.isFile() && hasMarkdownExtension(dirent.name)) return "document";
    return null;
  }

  private async walk(
    dirPath: string,
    visit: (entry: ContentEntry) => Promise<void>,
  ): Promise<void> {
    const entries = await this.listDirectory(dirPath);
    for (const entry of entries) {
      await visit(entry);
      if (entry.type === "directory") {
        await this.walk(entry.path, visit);
      }
    }
  }
}
