/**
 * Test-only in-memory GitHub API simulator. Not imported by application
 * code — used by the mocked test suites so they never hit the real GitHub
 * API or require credentials.
 */

export interface MockFileNode {
  type: "file";
  content: string;
}

export interface MockDirNode {
  type: "dir";
  children: Record<string, MockNode>;
}

export type MockNode = MockFileNode | MockDirNode;

export function file(content: string): MockFileNode {
  return { type: "file", content };
}

export function dir(children: Record<string, MockNode>): MockDirNode {
  return { type: "dir", children };
}

interface FlatFile {
  path: string;
  node: MockFileNode;
  sha: string;
}

function flatten(node: MockDirNode, prefix = ""): FlatFile[] {
  const out: FlatFile[] = [];
  for (const [name, child] of Object.entries(node.children)) {
    const entryPath = prefix === "" ? name : `${prefix}/${name}`;
    if (child.type === "file") {
      out.push({ path: entryPath, node: child, sha: `sha:${entryPath}` });
    } else {
      out.push(...flatten(child, entryPath));
    }
  }
  return out;
}

function getNodeAtPath(
  root: MockDirNode,
  targetPath: string,
): MockNode | undefined {
  if (targetPath === "") return root;
  let current: MockNode = root;
  for (const segment of targetPath.split("/")) {
    if (current.type !== "dir") return undefined;
    const next: MockNode | undefined = current.children[segment];
    if (!next) return undefined;
    current = next;
  }
  return current;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export interface MockGitHubOptions {
  owner?: string;
  repo?: string;
  /** If set, requests without a matching Authorization header get a 401. */
  requireToken?: string;
}

/**
 * Builds a fetch-compatible function that answers GitHub Contents API,
 * Git Trees API, and Git Blobs API requests against an in-memory tree.
 */
export function createMockGitHubFetch(
  root: MockDirNode,
  options: MockGitHubOptions = {},
): typeof fetch {
  const owner = options.owner ?? "test-owner";
  const repo = options.repo ?? "test-repo";
  const apiRoot = `https://api.github.com/repos/${owner}/${repo}`;
  const contentsPrefix = `${apiRoot}/contents`;
  const treePrefix = `${apiRoot}/git/trees/`;
  const blobPrefix = `${apiRoot}/git/blobs/`;
  const flatFiles = flatten(root);

  const mockFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (options.requireToken) {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("authorization");
      if (authHeader !== `Bearer ${options.requireToken}`) {
        return jsonResponse(401, { message: "Bad credentials" });
      }
    }

    if (rawUrl.startsWith(blobPrefix)) {
      const sha = decodeURIComponent(rawUrl.slice(blobPrefix.length));
      const entry = flatFiles.find((f) => f.sha === sha);
      if (!entry) return jsonResponse(404, { message: "Not Found" });
      return jsonResponse(200, {
        sha,
        content: Buffer.from(entry.node.content, "utf8").toString("base64"),
        encoding: "base64",
      });
    }

    if (rawUrl.startsWith(treePrefix)) {
      return jsonResponse(200, {
        sha: "root-tree-sha",
        truncated: false,
        tree: flatFiles.map((f) => ({
          path: f.path,
          mode: "100644",
          type: "blob" as const,
          sha: f.sha,
          size: f.node.content.length,
          url: "",
        })),
      });
    }

    if (rawUrl.startsWith(contentsPrefix)) {
      const url = new URL(rawUrl);
      const rawPath = url.pathname.slice(
        `/repos/${owner}/${repo}/contents`.length,
      );
      const targetPath = decodeURIComponent(
        rawPath.startsWith("/") ? rawPath.slice(1) : rawPath,
      );
      const node = getNodeAtPath(root, targetPath);
      if (!node) return jsonResponse(404, { message: "Not Found" });

      if (node.type === "file") {
        const name = targetPath.split("/").pop() ?? targetPath;
        return jsonResponse(200, {
          type: "file",
          name,
          path: targetPath,
          sha: `sha:${targetPath}`,
          size: node.content.length,
          encoding: "base64",
          content: Buffer.from(node.content, "utf8").toString("base64"),
          download_url: `https://raw.example.com/${targetPath}`,
        });
      }

      const entries = Object.entries(node.children).map(([name, child]) => ({
        type: child.type === "dir" ? "dir" : "file",
        name,
        path: targetPath === "" ? name : `${targetPath}/${name}`,
        sha: `sha:${targetPath === "" ? name : `${targetPath}/${name}`}`,
      }));
      return jsonResponse(200, entries);
    }

    return jsonResponse(404, { message: "Not Found" });
  };

  return mockFetch as typeof fetch;
}

/** A fetchImpl that always answers with a fixed status/body, for error-path tests. */
export function createStatusFetch(
  status: number,
  headers: Record<string, string> = {},
): typeof fetch {
  const mockFetch = async (): Promise<Response> =>
    jsonResponse(status, { message: `status ${status}` }, headers);
  return mockFetch as typeof fetch;
}

/** A fetchImpl that always rejects, simulating a network failure. */
export function createFailingFetch(
  error: Error = new Error("network down"),
): typeof fetch {
  const mockFetch = async (): Promise<Response> => {
    throw error;
  };
  return mockFetch as typeof fetch;
}

/** A fetchImpl that resolves with a body that isn't valid JSON. */
export function createMalformedJsonFetch(): typeof fetch {
  const mockFetch = async (): Promise<Response> =>
    new Response("not json", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  return mockFetch as typeof fetch;
}
