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

function cloneTree(node: MockDirNode): MockDirNode {
  return JSON.parse(JSON.stringify(node)) as MockDirNode;
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

function ensureDir(root: MockDirNode, segments: string[]): MockDirNode {
  let current = root;
  for (const segment of segments) {
    const existing = current.children[segment];
    if (existing && existing.type === "dir") {
      current = existing;
    } else {
      const created: MockDirNode = { type: "dir", children: {} };
      current.children[segment] = created;
      current = created;
    }
  }
  return current;
}

function setFileAtPath(
  root: MockDirNode,
  targetPath: string,
  content: string,
): void {
  const segments = targetPath.split("/");
  const fileName = segments.pop() as string;
  ensureDir(root, segments).children[fileName] = { type: "file", content };
}

function deleteFileAtPath(root: MockDirNode, targetPath: string): boolean {
  const segments = targetPath.split("/");
  const fileName = segments.pop() as string;
  const parent = getNodeAtPath(root, segments.join("/"));
  if (!parent || parent.type !== "dir" || !(fileName in parent.children)) {
    return false;
  }
  delete parent.children[fileName];
  return true;
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
  branch?: string;
  /** If set, requests without a matching Authorization header get a 401. */
  requireToken?: string;
}

/**
 * Builds a fetch-compatible function that answers GitHub Contents API, Git
 * Trees/Blobs API, ref, and write (PUT/DELETE contents) requests against an
 * in-memory tree. Writes mutate the tree and record a new "commit" snapshot,
 * so a subsequent read with `?ref=<that commit's parent sha>` sees the state
 * from just before the write — enough to exercise a real revert flow.
 */
export function createMockGitHubFetch(
  root: MockDirNode,
  options: MockGitHubOptions = {},
): typeof fetch {
  // Defensive clone: writes mutate this tree in place, and callers often pass
  // a fixture shared across many tests — never mutate what they handed us.
  root = cloneTree(root);
  const owner = options.owner ?? "test-owner";
  const repo = options.repo ?? "test-repo";
  const branch = options.branch ?? "main";
  const apiRoot = `https://api.github.com/repos/${owner}/${repo}`;
  const contentsPrefix = `${apiRoot}/contents`;
  const treePrefix = `${apiRoot}/git/trees/`;
  const blobPrefix = `${apiRoot}/git/blobs/`;
  const refPrefix = `${apiRoot}/git/ref/heads/`;
  const commitsPrefix = `${apiRoot}/commits`;

  let headSha = "commit-0";
  const history = new Map<string, MockDirNode>([[headSha, cloneTree(root)]]);
  let commitCounter = 0;
  // Chronological (oldest first); getLatestCommit reverses to find the most
  // recent entry whose path matches or is nested under the queried path.
  const commitLog: { path: string; message: string; date: string }[] = [];

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
    const method = (init?.method ?? "GET").toUpperCase();

    if (options.requireToken) {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("authorization");
      if (authHeader !== `Bearer ${options.requireToken}`) {
        return jsonResponse(401, { message: "Bad credentials" });
      }
    }

    if (rawUrl.startsWith(refPrefix)) {
      const requestedBranch = decodeURIComponent(
        rawUrl.slice(refPrefix.length),
      );
      if (requestedBranch !== branch) {
        return jsonResponse(404, { message: "Not Found" });
      }
      return jsonResponse(200, { object: { sha: headSha } });
    }

    if (rawUrl.startsWith(blobPrefix)) {
      const sha = decodeURIComponent(rawUrl.slice(blobPrefix.length));
      const entry = flatten(root).find((f) => f.sha === sha);
      if (!entry) return jsonResponse(404, { message: "Not Found" });
      return jsonResponse(200, {
        sha,
        content: Buffer.from(entry.node.content, "utf8").toString("base64"),
        encoding: "base64",
      });
    }

    if (rawUrl.startsWith(treePrefix)) {
      const flatFiles = flatten(root);
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

    if (rawUrl.startsWith(commitsPrefix)) {
      const url = new URL(rawUrl);
      const queryPath = url.searchParams.get("path") ?? "";
      const matches = commitLog.filter(
        (entry) =>
          entry.path === queryPath || entry.path.startsWith(`${queryPath}/`),
      );
      const latest = matches[matches.length - 1];
      if (!latest) return jsonResponse(200, []);
      return jsonResponse(200, [
        { commit: { message: latest.message, author: { date: latest.date } } },
      ]);
    }

    if (rawUrl.startsWith(contentsPrefix)) {
      const url = new URL(rawUrl);
      const rawPath = url.pathname.slice(
        `/repos/${owner}/${repo}/contents`.length,
      );
      const targetPath = decodeURIComponent(
        rawPath.startsWith("/") ? rawPath.slice(1) : rawPath,
      );

      if (method === "PUT") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const existing = getNodeAtPath(root, targetPath);
        const expectedSha =
          existing && existing.type === "file" ? `sha:${targetPath}` : null;
        if (expectedSha !== null && body.sha !== expectedSha) {
          return jsonResponse(409, { message: "sha does not match" });
        }
        if (expectedSha === null && body.sha) {
          return jsonResponse(409, { message: "file does not exist" });
        }

        const content = Buffer.from(body.content, "base64").toString("utf8");
        setFileAtPath(root, targetPath, content);
        commitCounter++;
        headSha = `commit-${commitCounter}`;
        history.set(headSha, cloneTree(root));
        commitLog.push({
          path: targetPath,
          message: body.message ?? "",
          date: new Date(commitCounter * 60_000).toISOString(),
        });

        return jsonResponse(200, {
          content: { sha: `sha:${targetPath}` },
          commit: { sha: headSha },
        });
      }

      if (method === "DELETE") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const existing = getNodeAtPath(root, targetPath);
        if (!existing || existing.type !== "file") {
          return jsonResponse(404, { message: "Not Found" });
        }
        if (body.sha !== `sha:${targetPath}`) {
          return jsonResponse(409, { message: "sha does not match" });
        }
        deleteFileAtPath(root, targetPath);
        commitCounter++;
        headSha = `commit-${commitCounter}`;
        history.set(headSha, cloneTree(root));
        commitLog.push({
          path: targetPath,
          message: body.message ?? "",
          date: new Date(commitCounter * 60_000).toISOString(),
        });

        return jsonResponse(200, { commit: { sha: headSha } });
      }

      const ref = url.searchParams.get("ref");
      const tree = ref && ref !== branch ? history.get(ref) : root;
      if (!tree) return jsonResponse(404, { message: "Not Found" });

      const node = getNodeAtPath(tree, targetPath);
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
