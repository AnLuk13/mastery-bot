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

  /**
   * Deletes an existing file, returning the pre-delete HEAD sha the same way
   * write() does — so the existing revert() (a generic "restore this path to
   * what it looked like at that commit" operation) undoes a delete exactly
   * like it undoes any other write, with no dedicated "undelete" logic.
   */
  async delete(inputPath: string, message: string): Promise<WriteResult> {
    const canonical = normalizeRelativePath(inputPath);
    if (canonical === "" || !hasMarkdownExtension(canonical)) {
      throw new InvalidPathError(`Not a writable document path: ${canonical}`);
    }
    const githubPath = this.toGitHubPath(canonical);

    const beforeCommitSha = await this.client.getBranchHeadSha(this.branch);
    const existing = await this.client.getContents(
      githubPath,
      this.branch,
      canonical,
    );
    if (Array.isArray(existing) || existing.type !== "file") {
      throw new ContentProviderUnavailableError(
        "Cannot delete: path is not a file",
      );
    }

    await this.client.deleteFile(
      githubPath,
      existing.sha,
      message,
      this.branch,
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

    // The path may currently not exist at all — either it was never created
    // (nothing to do), or it was deleted since beforeCommitSha (reverting a
    // delete needs to recreate it, not no-op). Either way, a missing current
    // sha just means the write below is a create rather than an update.
    let currentSha: string | undefined;
    try {
      const current = await this.client.getContents(
        githubPath,
        this.branch,
        canonical,
      );
      if (Array.isArray(current) || current.type !== "file") {
        throw new ContentProviderUnavailableError(
          "Cannot revert: path is not a file",
        );
      }
      currentSha = current.sha;
    } catch (error) {
      if (!(error instanceof ContentNotFoundError)) throw error;
      currentSha = undefined;
    }

    if (priorContent === undefined) {
      // Didn't exist as of beforeCommitSha — revert means "shouldn't exist."
      if (currentSha !== undefined) {
        await this.client.deleteFile(
          githubPath,
          currentSha,
          message,
          this.branch,
        );
      }
      // else: already gone, nothing to do.
    } else {
      // Existed as of beforeCommitSha — revert means "restore it," whether
      // it currently exists (update, sha required) or was deleted since
      // (create, sha omitted — GitHub rejects a create that passes one).
      await this.client.createOrUpdateFile(
        githubPath,
        priorContent,
        message,
        this.branch,
        currentSha,
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
