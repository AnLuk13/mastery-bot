import {
  ContentNotFoundError,
  ContentProviderUnavailableError,
  InvalidPathError,
} from "./errors";
import { GitHubApiClient } from "./github/GitHubApiClient";
import { hasMarkdownExtension } from "./markdown";
import { normalizeRelativePath } from "./paths";

export interface GitHubContentWriterOptions {
  owner: string;
  repo: string;
  branch: string;
  contentPath: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface WriteResult {
  path: string;
  /** The branch's HEAD commit sha immediately before this write — pass to revert() to undo just this one change. */
  beforeCommitSha: string;
}

/**
 * Write half of the GitHub content backend (see GitHubContentProvider for
 * reads). Kept as a separate class rather than added to ContentProvider:
 * only /save needs it, only for EDITORS, and every other provider
 * (LocalFilesystemContentProvider, and GitHubContentProvider itself) stays
 * read-only.
 *
 * Revert is a corrective commit, never a history rewrite: it restores
 * whatever the path looked like at `beforeCommitSha` (or deletes the file if
 * it didn't exist yet), the same "encode just enough to recompute, keep no
 * server state" shape as everything else in this app's Telegram layer.
 */
export class GitHubContentWriter {
  private readonly client: GitHubApiClient;
  private readonly branch: string;
  private readonly contentPathPrefix: string;

  constructor(options: GitHubContentWriterOptions) {
    this.client = new GitHubApiClient({
      owner: options.owner,
      repo: options.repo,
      token: options.token,
      fetchImpl: options.fetchImpl,
    });
    this.branch = options.branch;
    this.contentPathPrefix = normalizeRelativePath(options.contentPath);
  }

  async write(
    inputPath: string,
    content: string,
    message: string,
  ): Promise<WriteResult> {
    const canonical = normalizeRelativePath(inputPath);
    if (canonical === "" || !hasMarkdownExtension(canonical)) {
      throw new InvalidPathError(`Not a writable document path: ${canonical}`);
    }
    const githubPath = this.toGitHubPath(canonical);

    const beforeCommitSha = await this.client.getBranchHeadSha(this.branch);
    const currentSha = await this.currentFileSha(githubPath, canonical);

    await this.client.createOrUpdateFile(
      githubPath,
      content,
      message,
      this.branch,
      currentSha,
    );

    return { path: canonical, beforeCommitSha };
  }

  async revert(
    inputPath: string,
    beforeCommitSha: string,
    message: string,
  ): Promise<void> {
    const canonical = normalizeRelativePath(inputPath);
    const githubPath = this.toGitHubPath(canonical);

    const priorContent = await this.contentAsOf(
      githubPath,
      beforeCommitSha,
      canonical,
    );

    let current;
    try {
      current = await this.client.getContents(
        githubPath,
        this.branch,
        canonical,
      );
    } catch (error) {
      if (error instanceof ContentNotFoundError) return; // already gone — nothing left to revert
      throw error;
    }
    if (Array.isArray(current) || current.type !== "file") {
      throw new ContentProviderUnavailableError(
        "Cannot revert: path is not a file",
      );
    }

    if (priorContent === undefined) {
      await this.client.deleteFile(
        githubPath,
        current.sha,
        message,
        this.branch,
      );
    } else {
      await this.client.createOrUpdateFile(
        githubPath,
        priorContent,
        message,
        this.branch,
        current.sha,
      );
    }
  }

  private async currentFileSha(
    githubPath: string,
    notFoundPath: string,
  ): Promise<string | undefined> {
    try {
      const existing = await this.client.getContents(
        githubPath,
        this.branch,
        notFoundPath,
      );
      return !Array.isArray(existing) && existing.type === "file"
        ? existing.sha
        : undefined;
    } catch (error) {
      if (error instanceof ContentNotFoundError) return undefined;
      throw error;
    }
  }

  /** undefined return means the path didn't exist as of that commit. */
  private async contentAsOf(
    githubPath: string,
    ref: string,
    notFoundPath: string,
  ): Promise<string | undefined> {
    try {
      const item = await this.client.getContents(githubPath, ref, notFoundPath);
      if (Array.isArray(item) || item.type !== "file") return undefined;
      return await this.client.getFileContent(item, notFoundPath);
    } catch (error) {
      if (error instanceof ContentNotFoundError) return undefined;
      throw error;
    }
  }

  private toGitHubPath(canonical: string): string {
    if (this.contentPathPrefix === "") return canonical;
    return `${this.contentPathPrefix}/${canonical}`;
  }
}
