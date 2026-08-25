import path from "node:path";
import { ContentNotFoundError } from "./errors";
import { GitHubApiClient } from "./github/GitHubApiClient";
import { hasMarkdownExtension } from "./markdown";
import { joinCanonical, normalizeRelativePath } from "./paths";
import { buildSnippet } from "./snippet";
import { compareContentEntries } from "./sort";
import type {
  CommitInfo,
  ContentEntry,
  ContentProvider,
  Document,
  SearchResult,
} from "./types";

export interface GitHubContentProviderOptions {
  owner: string;
  repo: string;
  branch: string;
  /**
   * Path inside the repository where the content root lives. "" means the
   * content root is the repository root. Validated with the same rules as
   * any other content-relative path (no leading/trailing slash, no traversal).
   */
  contentPath: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

interface SearchCandidate {
  canonical: string;
  name: string;
  sha: string;
}

/**
 * ContentProvider backed by the GitHub REST API (Contents API for browsing,
 * Git Trees/Blobs API for search). See GitHubApiClient for the HTTP
 * mechanics; this class only maps GitHub's data model to the domain types
 * in ./types and enforces the same path-safety rules as every other
 * provider.
 *
 * Path mapping: a canonical content-relative path (e.g.
 * "networking-mastery/tcp.md") is prefixed with GITHUB_CONTENT_PATH (if
 * any) to form the GitHub repository path (e.g. "mastery/networking-mastery/tcp.md"),
 * which GitHubApiClient then percent-encodes per path segment before
 * building the request URL.
 */
export class GitHubContentProvider implements ContentProvider {
  private readonly client: GitHubApiClient;
  private readonly branch: string;
  private readonly contentPathPrefix: string;

  constructor(options: GitHubContentProviderOptions) {
    this.client = new GitHubApiClient({
      owner: options.owner,
      repo: options.repo,
      token: options.token,
      fetchImpl: options.fetchImpl,
    });
    this.branch = options.branch;
    // Reuses the same validation as user-supplied paths: rejects traversal,
    // absolute paths, etc. in the operator-configured GITHUB_CONTENT_PATH too.
    this.contentPathPrefix = normalizeRelativePath(options.contentPath);
  }

  async listDirectory(inputPath: string): Promise<ContentEntry[]> {
    const canonical = normalizeRelativePath(inputPath);
    const githubPath = this.toGitHubPath(canonical);
    const result = await this.client.getContents(
      githubPath,
      this.branch,
      canonical,
    );

    if (!Array.isArray(result)) {
      throw new ContentNotFoundError(canonical);
    }

    const entries: ContentEntry[] = [];
    for (const item of result) {
      if (item.name.startsWith(".")) continue;

      if (item.type === "dir") {
        entries.push({
          type: "directory",
          name: item.name,
          path: joinCanonical(canonical, item.name),
        });
      } else if (item.type === "file" && hasMarkdownExtension(item.name)) {
        entries.push({
          type: "document",
          name: item.name,
          path: joinCanonical(canonical, item.name),
        });
      }
      // symlinks, submodules, and non-markdown files are ignored
    }

    entries.sort(compareContentEntries);
    return entries;
  }

  async getDocument(inputPath: string): Promise<Document> {
    const canonical = normalizeRelativePath(inputPath);
    if (canonical === "" || !hasMarkdownExtension(canonical)) {
      throw new ContentNotFoundError(canonical);
    }

    const githubPath = this.toGitHubPath(canonical);
    const result = await this.client.getContents(
      githubPath,
      this.branch,
      canonical,
    );

    if (Array.isArray(result) || result.type !== "file") {
      throw new ContentNotFoundError(canonical);
    }

    const content = await this.client.getFileContent(result, canonical);
    return { path: canonical, name: path.posix.basename(canonical), content };
  }

  /**
   * Tradeoff: GitHub's Contents API only lists one directory per request, so
   * a full-text search needs a different approach. We fetch the repository's
   * recursive tree in a single request (Git Trees API), which is cheap and
   * gives every file's path + blob sha with no extra calls. Filename/path
   * matches are resolved from that alone. Content matches require fetching
   * each remaining candidate's blob — so a query that matches nothing by
   * name, over a large knowledge base, costs one request per markdown file.
   * That's acceptable for a personal knowledge base (tens to low hundreds of
   * files) but would need caching/indexing (Stage 9) to scale further.
   */
  async search(query: string): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery === "") return [];
    const lowerQuery = trimmedQuery.toLowerCase();

    const { entries } = await this.client.getTree(this.branch);
    const candidates: SearchCandidate[] = [];
    for (const entry of entries) {
      if (entry.type !== "blob") continue;
      const relative = this.fromGitHubPath(entry.path);
      if (relative === null) continue;
      if (!hasMarkdownExtension(relative)) continue;
      if (relative.split("/").some((segment) => segment.startsWith(".")))
        continue;
      candidates.push({
        canonical: relative,
        name: path.posix.basename(relative),
        sha: entry.sha,
      });
    }

    const results: SearchResult[] = [];
    for (const candidate of candidates) {
      if (candidate.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          path: candidate.canonical,
          name: candidate.name,
          matchType: "filename",
        });
        continue;
      }
      if (candidate.canonical.toLowerCase().includes(lowerQuery)) {
        results.push({
          path: candidate.canonical,
          name: candidate.name,
          matchType: "path",
        });
        continue;
      }

      const content = await this.client.getBlob(
        candidate.sha,
        candidate.canonical,
      );
      const matchIndex = content.toLowerCase().indexOf(lowerQuery);
      if (matchIndex !== -1) {
        results.push({
          path: candidate.canonical,
          name: candidate.name,
          matchType: "content",
          snippet: buildSnippet(content, matchIndex, trimmedQuery.length),
        });
      }
    }

    return results;
  }

  async getLatestCommit(inputPath: string): Promise<CommitInfo | undefined> {
    const canonical = normalizeRelativePath(inputPath);
    const githubPath = this.toGitHubPath(canonical);
    return this.client.getLatestCommit(githubPath, this.branch);
  }

  private toGitHubPath(canonical: string): string {
    if (this.contentPathPrefix === "") return canonical;
    if (canonical === "") return this.contentPathPrefix;
    return `${this.contentPathPrefix}/${canonical}`;
  }

  private fromGitHubPath(githubPath: string): string | null {
    if (this.contentPathPrefix === "") return githubPath;
    const withPrefix = `${this.contentPathPrefix}/`;
    if (!githubPath.startsWith(withPrefix)) return null;
    return githubPath.slice(withPrefix.length);
  }
}
