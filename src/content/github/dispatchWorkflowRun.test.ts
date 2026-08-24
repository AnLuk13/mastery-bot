import { describe, expect, it, vi } from "vitest";
import { dispatchWorkflowRun } from "./dispatchWorkflowRun";

function fakeFetch(response: Partial<Response>): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe("dispatchWorkflowRun", () => {
  it("posts to the workflow's dispatches endpoint with the ref and auth header", async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 204 });

    await dispatchWorkflowRun({
      owner: "AnLuk13",
      repo: "mastery-bot",
      workflowFile: "reindex.yml",
      ref: "main",
      token: "test-token",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/AnLuk13/mastery-bot/actions/workflows/reindex.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ref: "main" }),
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("throws when GitHub rejects the request", async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 404 });

    await expect(
      dispatchWorkflowRun({
        owner: "AnLuk13",
        repo: "mastery-bot",
        workflowFile: "reindex.yml",
        ref: "main",
        token: "test-token",
        fetchImpl,
      }),
    ).rejects.toThrow(/404/);
  });

  it("throws on a network error", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("boom")) as unknown as typeof fetch;

    await expect(
      dispatchWorkflowRun({
        owner: "AnLuk13",
        repo: "mastery-bot",
        workflowFile: "reindex.yml",
        ref: "main",
        token: "test-token",
        fetchImpl,
      }),
    ).rejects.toThrow(/Network error/);
  });
});
