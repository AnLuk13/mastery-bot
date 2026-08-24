const GITHUB_API_BASE = "https://api.github.com";

export interface DispatchWorkflowOptions {
  owner: string;
  repo: string;
  workflowFile: string;
  ref: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/**
 * Triggers a `workflow_dispatch` run via the GitHub Actions API. Used to kick
 * off mastery-bot's reindex workflow the instant content actually changes
 * (see GitHubContentWriter's onContentChanged) instead of polling on a cron
 * — the caller is expected to treat this as fire-and-forget and log rather
 * than fail its own operation if it throws.
 */
export async function dispatchWorkflowRun(
  options: DispatchWorkflowOptions,
): Promise<void> {
  const { owner, repo, workflowFile, ref, token } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mastery-bot",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref }),
    });
  } catch (error) {
    throw new Error(
      `Network error dispatching ${workflowFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `GitHub rejected the workflow_dispatch request for ${workflowFile} (${response.status})`,
    );
  }
}
