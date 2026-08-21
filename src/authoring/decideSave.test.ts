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

  it("rejects a new file placed flat under the editor's folder, with no topic subfolder", async () => {
    const groq = fakeGroq({
      action: "write",
      path: "antonio/meeting.md",
      isNewFile: true,
      content: "# Meeting",
      commitMessage: "save: meeting",
    });
    await expect(decideSave(baseCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });

  it("does not require a topic subfolder for an existing-file (merge) decision", async () => {
    const groq = fakeGroq({
      action: "write",
      path: "antonio/networking/dns.md",
      isNewFile: false,
      commitMessage: "save: dns update",
    });
    const decision = await decideSave(baseCtx, groq);
    expect(decision).toMatchObject({
      action: "write",
      path: "antonio/networking/dns.md",
      isNewFile: false,
    });
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

describe("decideSave reorganize", () => {
  const flatCtx: SaveRequestContext = {
    editorFolder: "andreea",
    request: "add a note about tomorrow's sales call",
    existingEntries: ["andreea/meeting.md"],
    clarifyRound: 0,
  };

  it("accepts a reorganize decision that groups a new note with an existing flat file", async () => {
    const groq = fakeGroq({
      action: "reorganize",
      moveFrom: "andreea/meeting.md",
      moveTo: "andreea/meetings/kickoff.md",
      newPath: "andreea/meetings/sales-call.md",
      content: "# Sales call\nTomorrow at 3pm.",
      commitMessage: "save: sales call note",
    });
    const decision = await decideSave(flatCtx, groq);
    expect(decision).toEqual({
      action: "reorganize",
      moveFrom: "andreea/meeting.md",
      moveTo: "andreea/meetings/kickoff.md",
      newPath: "andreea/meetings/sales-call.md",
      content: "# Sales call\nTomorrow at 3pm.",
      commitMessage: "save: sales call note",
    });
  });

  it("rejects a moveFrom that isn't one of the editor's actual existing documents", async () => {
    const groq = fakeGroq({
      action: "reorganize",
      moveFrom: "andreea/made-up.md",
      moveTo: "andreea/meetings/kickoff.md",
      newPath: "andreea/meetings/sales-call.md",
      content: "x",
      commitMessage: "x",
    });
    await expect(decideSave(flatCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });

  it("rejects reorganizing a file that's already inside a topic subfolder", async () => {
    const ctx: SaveRequestContext = {
      ...flatCtx,
      existingEntries: ["andreea/meetings/kickoff.md"],
    };
    const groq = fakeGroq({
      action: "reorganize",
      moveFrom: "andreea/meetings/kickoff.md",
      moveTo: "andreea/meetings/renamed.md",
      newPath: "andreea/meetings/sales-call.md",
      content: "x",
      commitMessage: "x",
    });
    await expect(decideSave(ctx, groq)).rejects.toThrow(GroqUnavailableError);
  });

  it("rejects a moveTo without a topic subfolder", async () => {
    const groq = fakeGroq({
      action: "reorganize",
      moveFrom: "andreea/meeting.md",
      moveTo: "andreea/renamed.md",
      newPath: "andreea/meetings/sales-call.md",
      content: "x",
      commitMessage: "x",
    });
    await expect(decideSave(flatCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });

  it("rejects a newPath without a topic subfolder", async () => {
    const groq = fakeGroq({
      action: "reorganize",
      moveFrom: "andreea/meeting.md",
      moveTo: "andreea/meetings/kickoff.md",
      newPath: "andreea/sales-call.md",
      content: "x",
      commitMessage: "x",
    });
    await expect(decideSave(flatCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });

  it("rejects moveTo and newPath colliding on the same path", async () => {
    const groq = fakeGroq({
      action: "reorganize",
      moveFrom: "andreea/meeting.md",
      moveTo: "andreea/meetings/same.md",
      newPath: "andreea/meetings/same.md",
      content: "x",
      commitMessage: "x",
    });
    await expect(decideSave(flatCtx, groq)).rejects.toThrow(
      GroqUnavailableError,
    );
  });

  it("rejects a reorganize proposal escaping the editor's folder via traversal", async () => {
    const groq = fakeGroq({
      action: "reorganize",
      moveFrom: "andreea/meeting.md",
      moveTo: "andreea/../someone-else/meetings/kickoff.md",
      newPath: "andreea/meetings/sales-call.md",
      content: "x",
      commitMessage: "x",
    });
    await expect(decideSave(flatCtx, groq)).rejects.toThrow(
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
