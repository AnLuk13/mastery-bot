import { z } from "zod";
import {
  ContentNotFoundError,
  ContentProviderAuthError,
  ContentProviderPermissionError,
  ContentProviderRateLimitedError,
  ContentProviderUnavailableError,
  ContentWriteConflictError,
} from "../errors";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * A GitHub Contents API entry. The same shape covers both a directory
 * listing element and a single-file response — directory listings omit
 * `content`/`encoding`/`download_url`, so those stay optional.
 */
const contentItemSchema = z.object({
  type: z.enum(["file", "dir", "symlink", "submodule"]),
  name: z.string(),
  path: z.string(),
  sha: z.string(),
  size: z.number().optional(),
  encoding: z.string().optional(),
  content: z.string().optional(),
  download_url: z.string().nullable().optional(),
});

const contentsResponseSchema = z.union([
  contentItemSchema,
  z.array(contentItemSchema),
]);

const treeEntrySchema = z.object({
  path: z.string(),
  type: z.enum(["blob", "tree", "commit"]),
  sha: z.string(),
  size: z.number().optional(),
});

const treeResponseSchema = z.object({
  sha: z.string(),
  tree: z.array(treeEntrySchema),
  truncated: z.boolean(),
});

const blobResponseSchema = z.object({
  sha: z.string(),
  content: z.string(),
  encoding: z.string(),
});

const refResponseSchema = z.object({
  object: z.object({ sha: z.string() }),
});

const putContentsResponseSchema = z.object({
  content: z.object({ sha: z.string() }),
  commit: z.object({ sha: z.string() }),
});

export type GitHubContentItem = z.infer<typeof contentItemSchema>;
export type GitHubTreeEntry = z.infer<typeof treeEntrySchema>;
export interface GitHubTreeResult {
  entries: GitHubTreeEntry[];
  truncated: boolean;
}

export interface PutFileResult {
  /** sha of the new commit this write created — captured by callers before writing, so a later revert can be scoped to just this one write. */
  commitSha: string;
  /** sha of the new blob — required by GitHub to make any further write to this same path. */
  contentSha: string;
}

export interface GitHubApiClientOptions {
  owner: string;
  repo: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

function decodeBase64Content(content: string, encoding: string): string {
  if (encoding !== "base64") {
    throw new ContentProviderUnavailableError(
      `Unsupported GitHub content encoding: ${encoding}`,
    );
  }
  return Buffer.from(content, "base64").toString("utf8");
}

export class GitHubApiClient {
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GitHubApiClientOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Fetches the GitHub Contents API entry at `githubPath` (repo-root-relative,
   * NOT percent-encoded by the caller). Returns an array for a directory, or
   * a single item for a file. `notFoundPath` is the canonical application
   * path to report if GitHub responds 404.
   */
  async getContents(
    githubPath: string,
    ref: string,
    notFoundPath: string,
  ): Promise<GitHubContentItem | GitHubContentItem[]> {
    const url = this.buildContentsUrl(githubPath, ref);
    const json = await this.requestJson(url, notFoundPath);
    const parsed = contentsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ContentProviderUnavailableError(
        "GitHub returned an unexpected content response shape",
      );
    }
    return parsed.data;
  }

  /** Fetches the file body for a Contents API file item, following `download_url` for large files. */
  async getFileContent(
    item: GitHubContentItem,
    notFoundPath: string,
  ): Promise<string> {
    if (item.content !== undefined && item.encoding !== undefined) {
      return decodeBase64Content(item.content, item.encoding);
    }
    if (item.download_url) {
      let response: Response;
      try {
        response = await this.fetchImpl(item.download_url);
      } catch {
        throw new ContentProviderUnavailableError(
          "Network error while downloading GitHub content",
        );
      }
      if (!response.ok) {
        await this.throwForStatus(response, notFoundPath);
      }
      return await response.text();
    }
    throw new ContentProviderUnavailableError(
      "GitHub content is too large to retrieve",
    );
  }

  /** Fetches the full recursive tree for `ref` in a single request. */
  async getTree(ref: string): Promise<GitHubTreeResult> {
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const json = await this.requestJson(url, "");
    const parsed = treeResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ContentProviderUnavailableError(
        "GitHub returned an unexpected tree response shape",
      );
    }
    return { entries: parsed.data.tree, truncated: parsed.data.truncated };
  }

  /** Fetches and decodes a blob by sha (used to read search-candidate content without re-resolving a path). */
  async getBlob(sha: string, notFoundPath: string): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/blobs/${encodeURIComponent(sha)}`;
    const json = await this.requestJson(url, notFoundPath);
    const parsed = blobResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ContentProviderUnavailableError(
        "GitHub returned an unexpected blob response shape",
      );
    }
    return decodeBase64Content(parsed.data.content, parsed.data.encoding);
  }

  /** The current HEAD commit sha for `branch` — callers capture this immediately before a write, to scope a later revert to exactly that one change. */
  async getBranchHeadSha(branch: string): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
    const json = await this.requestJson(url, "");
    const parsed = refResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ContentProviderUnavailableError(
        "GitHub returned an unexpected ref response shape",
      );
    }
    return parsed.data.object.sha;
  }

  /**
   * Creates or updates a file. `sha` is the file's current blob sha and is
   * required when overwriting an existing file (GitHub rejects a create-only
   * write, and rejects an update whose sha doesn't match the current one —
   * surfaced as ContentWriteConflictError).
   */
  async createOrUpdateFile(
    githubPath: string,
    content: string,
    message: string,
    branch: string,
    sha?: string,
  ): Promise<PutFileResult> {
    const url = this.buildContentsUrl(githubPath, undefined);
    const json = await this.mutateJson(url, "PUT", githubPath, {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    });
    const parsed = putContentsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ContentProviderUnavailableError(
        "GitHub returned an unexpected write response shape",
      );
    }
    return {
      commitSha: parsed.data.commit.sha,
      contentSha: parsed.data.content.sha,
    };
  }

  /** Deletes a file; `sha` must match its current blob sha. */
  async deleteFile(
    githubPath: string,
    sha: string,
    message: string,
    branch: string,
  ): Promise<void> {
    const url = this.buildContentsUrl(githubPath, undefined);
    await this.mutateJson(url, "DELETE", githubPath, { message, sha, branch });
  }

  /** `ref` selects a point in history for a read; omit it for a write (which targets `branch` in the request body instead). */
  private buildContentsUrl(
    githubPath: string,
    ref: string | undefined,
  ): string {
    const segments =
      githubPath === "" ? [] : githubPath.split("/").map(encodeURIComponent);
    const base = `${GITHUB_API_BASE}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents`;
    const withPath =
      segments.length > 0 ? `${base}/${segments.join("/")}` : base;
    if (ref === undefined) return withPath;
    const url = new URL(withPath);
    url.searchParams.set("ref", ref);
    return url.toString();
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mastery-bot",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async requestJson(
    url: string,
    notFoundPath: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: this.authHeaders() });
    } catch {
      throw new ContentProviderUnavailableError(
        "Network error while contacting GitHub",
      );
    }

    if (!response.ok) {
      await this.throwForStatus(response, notFoundPath);
    }

    try {
      return await response.json();
    } catch {
      throw new ContentProviderUnavailableError(
        "GitHub returned a malformed response",
      );
    }
  }

  private async mutateJson(
    url: string,
    method: "PUT" | "DELETE",
    notFoundPath: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ContentProviderUnavailableError(
        "Network error while contacting GitHub",
      );
    }

    if (!response.ok) {
      await this.throwForStatus(response, notFoundPath);
    }

    try {
      return await response.json();
    } catch {
      throw new ContentProviderUnavailableError(
        "GitHub returned a malformed response",
      );
    }
  }

  private async throwForStatus(
    response: Response,
    notFoundPath: string,
  ): Promise<never> {
    if (response.status === 404) {
      throw new ContentNotFoundError(notFoundPath);
    }
    if (response.status === 409) {
      throw new ContentWriteConflictError();
    }
    if (response.status === 401) {
      throw new ContentProviderAuthError();
    }
    if (response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      const retryAfter = response.headers.get("retry-after");
      if (remaining === "0" || retryAfter !== null) {
        throw new ContentProviderRateLimitedError(
          retryAfter ? Number(retryAfter) : undefined,
        );
      }
      throw new ContentProviderPermissionError();
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new ContentProviderRateLimitedError(
        retryAfter ? Number(retryAfter) : undefined,
      );
    }
    if (response.status >= 500) {
      throw new ContentProviderUnavailableError(
        `GitHub returned a server error (${response.status})`,
      );
    }
    throw new ContentProviderUnavailableError(
      `GitHub returned an unexpected status (${response.status})`,
    );
  }
}
