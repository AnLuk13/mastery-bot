import { describe, expect, it } from "vitest";
import { GroqUnavailableError } from "@/rag/errors";
import { composeUpdate, decideSave } from "./decideSave";
import type { SaveRequestContext } from "./types";

function fakeGroq(reply: unknown) {
  return {
    createChatCompletion: async () => ({
      text: JSON.stringify(reply),
      rateLimit: undefined,
    }),
  };
}

const baseCtx: SaveRequestContext = {
  editorFolder: "antonio",
  request: "remember to check TCP keepalive on the LB",
  existingEntries: ["antonio/networking/dns.md"],
  clarifyRound: 0,
};

describe("decideSave", () => {
  it("returns a clarify decision as-is", async () => {
    const groq = fakeGroq({
      action: "clarify",
      questions: ["Which topic folder should this go under?"],
    });
    const decision = await decideSave(baseCtx, groq);
    expect(decision).toEqual({
      action: "clarify",
      questions: ["Which topic folder should this go under?"],
    });
  });

  it("accepts a new-file write decision inside the editor's folder", async () => {
    const groq = fakeGroq({
      action: "write",
      path: "antonio/networking/keepalive.md",
      isNewFile: true,
      content: "# Keepalive\nCheck TCP keepalive on the LB.",
      commitMessage: "save: keepalive note",
    });
    const decision = await decideSave(baseCtx, groq);
    expect(decision).toMatchObject({
      action: "write",
      path: "antonio/networking/keepalive.md",
      isNewFile: true,
    });
  });

  it("rejects a path outside the editor's folder", async () => {
    const groq = fakeGroq({
      action: "write",
      path: "someone-else/notes.md",
      isNewFile: true,
      content: "x",
      commitMessage: "x",
    });
    await expect(decideSave(baseCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });

  it("rejects a path that escapes via traversal despite a matching string prefix", async () => {
    const groq = fakeGroq({
      action: "write",
      path: "antonio/../someone-else/notes.md",
      isNewFile: true,
      content: "x",
      commitMessage: "x",
    });
    await expect(decideSave(baseCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });

  it("rejects a non-Markdown path", async () => {
    const groq = fakeGroq({
      action: "write",
      path: "antonio/notes.txt",
      isNewFile: true,
      content: "x",
      commitMessage: "x",
    });
    await expect(decideSave(baseCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });

  it("throws when the model returns malformed JSON", async () => {
    const groq = {
      createChatCompletion: async () => ({
        text: "not json",
        rateLimit: undefined,
      }),
    };
    await expect(decideSave(baseCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });

  it("throws when the response doesn't match the decision schema", async () => {
    const groq = fakeGroq({ unexpected: true });
    await expect(decideSave(baseCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });
});

describe("composeUpdate", () => {
  it("returns the merged content and commit message", async () => {
    const groq = fakeGroq({
      content: "# DNS\nOriginal.\n\n## New section\nMerged in.",
      commitMessage: "save: add DNS caching note",
    });
    const result = await composeUpdate(
      "# DNS\nOriginal.",
      "add a note about DNS caching",
      groq,
    );
    expect(result.commitMessage).toBe("save: add DNS caching note");
    expect(result.content).toContain("Merged in.");
  });

  it("throws when the response doesn't match the schema", async () => {
    const groq = fakeGroq({ content: "x" });
    await expect(
      composeUpdate("existing", "new material", groq),
    ).rejects.toThrow(GroqUnavailableError);
  });
});
