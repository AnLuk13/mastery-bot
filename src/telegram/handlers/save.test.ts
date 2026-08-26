import { describe, expect, it } from "vitest";
import { ContentNotFoundError } from "@/content";
import type { EditorConfig } from "@/lib/env";
import {
  createFakeBotContext,
  createFakeContentProvider,
  createFakeContentWriter,
  createFakeSessionStore,
} from "../testHelpers";
import {
  createDeleteConfirmHandler,
  createReorganizeConfirmHandler,
  createRevertHandler,
  createSaveFromMessageHandler,
  createSaveHandler,
  isSaveClarifyContinuation,
  type SaveDeps,
} from "./save";

const editors: EditorConfig[] = [{ userId: 712059530, folder: "antonio" }];

function fakeGroqReturning(reply: unknown) {
  return {
    createChatCompletion: async () => ({
      text: JSON.stringify(reply),
      rateLimit: undefined,
    }),
  };
}

function baseDeps(overrides: Partial<SaveDeps> = {}): SaveDeps {
  const { writer } = createFakeContentWriter();
  return {
    editors,
    contentProvider: overrides.contentProvider ?? createFakeContentProvider(),
    contentWriter: overrides.contentWriter ?? writer,
    groq:
      overrides.groq ??
      fakeGroqReturning({
        action: "write",
        path: "antonio/networking/keepalive.md",
        isNewFile: true,
        content: "# Keepalive\nCheck TCP keepalive on the LB.",
        commitMessage: "save: keepalive note",
      }),
    sessionStore: overrides.sessionStore ?? createFakeSessionStore(),
  };
}

describe("createSaveHandler", () => {
  it("denies a non-editor", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 999,
      commandArgs: "a note",
    });
    await createSaveHandler(baseDeps())(ctx);
    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("shows usage when /save is called with no text and no upload", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "",
    });
    await createSaveHandler(baseDeps())(ctx);
    expect(sendMessageCalls[0].text).toMatch(/usage/i);
  });

  it("writes a new file and replies with a preview + keyboard", async () => {
    const { writer, writes } = createFakeContentWriter({
      beforeCommitSha: "abcdef123456",
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "remember to check TCP keepalive on the LB",
    });

    await createSaveHandler(baseDeps({ contentWriter: writer }))(ctx);

    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("antonio/networking/keepalive.md");
    expect(sendMessageCalls[0].text).toContain(
      "antonio/networking/keepalive.md",
    );
    expect(sendMessageCalls[0].keyboard?.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({ text: "↩️ Revert" }),
    );
  });

  it("merges into an existing file via composeUpdate before writing", async () => {
    const { writer, writes } = createFakeContentWriter();
    const contentProvider = createFakeContentProvider({
      getDocument: async () => ({
        path: "antonio/networking/dns.md",
        name: "dns.md",
        content: "# DNS\nOriginal.",
      }),
    });

    let call = 0;
    const groq = {
      createChatCompletion: async () => {
        call++;
        if (call === 1) {
          return {
            text: JSON.stringify({
              action: "write",
              path: "antonio/networking/dns.md",
              isNewFile: false,
              commitMessage: "save: dns note",
            }),
            rateLimit: undefined,
          };
        }
        return {
          text: JSON.stringify({
            content: "# DNS\nOriginal.\n\n## Caching\nNew info.",
            commitMessage: "save: add DNS caching info",
          }),
          rateLimit: undefined,
        };
      },
    };

    const { ctx } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "add a note about DNS caching",
    });
    await createSaveHandler(
      baseDeps({ contentWriter: writer, contentProvider, groq }),
    )(ctx);

    expect(writes).toHaveLength(1);
    expect(writes[0].content).toContain("New info.");
    expect(writes[0].message).toBe("save: add DNS caching info");
  });

  it("asks a clarifying question instead of writing when the model is unsure", async () => {
    const { writer, writes } = createFakeContentWriter();
    const groq = fakeGroqReturning({
      action: "clarify",
      questions: ["Which topic should this go under?"],
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "something vague",
    });

    await createSaveHandler(baseDeps({ contentWriter: writer, groq }))(ctx);

    expect(writes).toHaveLength(0);
    expect(sendMessageCalls[0].text).toContain(
      "Which topic should this go under?",
    );
    expect(sendMessageCalls[0].text).toContain("something vague");
  });

  it("stores the full request server-side when asking a clarifying question", async () => {
    const groq = fakeGroqReturning({
      action: "clarify",
      questions: ["Which topic?"],
    });
    const sessionStore = createFakeSessionStore();
    const { ctx } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "something vague",
    });

    await createSaveHandler(baseDeps({ groq, sessionStore }))(ctx);

    expect((await sessionStore.get(712059530)).pendingSaveRequest).toBe(
      "something vague",
    );
  });

  it("uses the full server-stored request on round 2, not just the (possibly truncated) message echo", async () => {
    const capturedMessages: unknown[] = [];
    const longOriginalRequest = `Uploaded file "big.md":\n${"x".repeat(5000)}`;
    const groq = {
      createChatCompletion: async (messages: unknown) => {
        capturedMessages.push(messages);
        return {
          text: JSON.stringify({
            action: "write",
            path: "antonio/networking/keepalive.md",
            isNewFile: true,
            content: "# Keepalive",
            commitMessage: "save",
          }),
          rateLimit: undefined,
        };
      },
    };
    const sessionStore = createFakeSessionStore({
      712059530: { transcript: "", pendingSaveRequest: longOriginalRequest },
    });
    const { ctx } = createFakeBotContext({
      userId: 712059530,
      messageText: "networking",
      replyToMessageText:
        "❓ Need a bit more info to save this:\n1. Which topic?\n\n⎯⎯⎯ save-context (do not edit) ⎯⎯⎯\n(truncated echo, much shorter than the real file)",
    });

    await createSaveHandler(baseDeps({ groq, sessionStore }))(ctx);

    // The classification prompt is capped (see MAX_SAVE_REQUEST_PREVIEW_CHARS
    // in decideSave.ts, a deliberate limit to avoid a 413 from Groq on a
    // large request) — but it's a cap on the full stored original, not a
    // fallback to the short message echo.
    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("x".repeat(1000));
    expect(prompt).not.toContain("truncated echo, much shorter");
  });

  it("rejects an unsupported uploaded file type", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      document: { fileId: "f1", fileName: "photo.png", mimeType: "image/png" },
    });
    await createSaveHandler(baseDeps())(ctx);
    expect(sendMessageCalls[0].text).toMatch(/\.txt.*\.md|only.*supported/i);
  });

  it("downloads a supported uploaded file and includes it in the save request", async () => {
    const capturedMessages: unknown[] = [];
    const groq = {
      createChatCompletion: async (messages: unknown) => {
        capturedMessages.push(messages);
        return {
          text: JSON.stringify({
            action: "write",
            path: "antonio/general/upload.md",
            isNewFile: true,
            content: "# Upload\nfrom file",
            commitMessage: "save: upload",
          }),
          rateLimit: undefined,
        };
      },
    };
    const { ctx } = createFakeBotContext({
      userId: 712059530,
      document: { fileId: "f1", fileName: "note.txt", mimeType: "text/plain" },
      downloadDocument: async () => "raw file content",
    });

    await createSaveHandler(baseDeps({ groq }))(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("raw file content");
    expect(prompt).toContain("note.txt");
  });

  it("writes a large uploaded file's content verbatim, without asking Groq to reproduce it (avoids the 413 an uncapped prompt hit)", async () => {
    const { writer, writes } = createFakeContentWriter();
    const capturedMessages: unknown[] = [];
    const largeUpload = "# Notes\n" + "x".repeat(20_000);
    const groq = {
      createChatCompletion: async (messages: unknown) => {
        capturedMessages.push(messages);
        // The model is told not to include content for an upload-derived new
        // file — this response reflects that, omitting it entirely.
        return {
          text: JSON.stringify({
            action: "write",
            path: "antonio/general/big-upload.md",
            isNewFile: true,
            commitMessage: "save: big upload",
          }),
          rateLimit: undefined,
        };
      },
    };
    const { ctx } = createFakeBotContext({
      userId: 712059530,
      document: { fileId: "f1", fileName: "big.md", mimeType: "text/markdown" },
      downloadDocument: async () => largeUpload,
    });

    await createSaveHandler(baseDeps({ contentWriter: writer, groq }))(ctx);

    // The prompt sent to Groq stays well under the full upload's size...
    const promptSize = JSON.stringify(capturedMessages).length;
    expect(promptSize).toBeLessThan(largeUpload.length);
    // ...but the file actually written keeps every byte of the original.
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toBe(largeUpload);
  });

  it("combines the echoed clarify context with the reply as a round-2 request", async () => {
    const capturedMessages: unknown[] = [];
    const groq = {
      createChatCompletion: async (messages: unknown) => {
        capturedMessages.push(messages);
        return {
          text: JSON.stringify({
            action: "write",
            path: "antonio/networking/keepalive.md",
            isNewFile: true,
            content: "# Keepalive",
            commitMessage: "save",
          }),
          rateLimit: undefined,
        };
      },
    };
    const { ctx } = createFakeBotContext({
      userId: 712059530,
      messageText: "networking",
      replyToMessageText:
        "❓ Need a bit more info to save this:\n1. Which topic?\n\n⎯⎯⎯ save-context (do not edit) ⎯⎯⎯\ncheck TCP keepalive on the LB",
    });

    await createSaveHandler(baseDeps({ groq }))(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("check TCP keepalive on the LB");
    expect(prompt).toContain("networking");
  });

  it("saves the content of an ordinary replied-to message when /save is used with no other text", async () => {
    const capturedMessages: unknown[] = [];
    const groq = {
      createChatCompletion: async (messages: unknown) => {
        capturedMessages.push(messages);
        return {
          text: JSON.stringify({
            action: "write",
            path: "antonio/networking/keepalive.md",
            isNewFile: true,
            content: "# Keepalive",
            commitMessage: "save",
          }),
          rateLimit: undefined,
        };
      },
    };
    const { ctx } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "",
      replyToMessageText: "TCP keepalive should be checked on the LB.",
    });

    await createSaveHandler(baseDeps({ groq }))(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("TCP keepalive should be checked on the LB.");
  });

  it("combines a replied-to message's content with typed instructions", async () => {
    const capturedMessages: unknown[] = [];
    const groq = {
      createChatCompletion: async (messages: unknown) => {
        capturedMessages.push(messages);
        return {
          text: JSON.stringify({
            action: "write",
            path: "antonio/networking/keepalive.md",
            isNewFile: true,
            content: "# Keepalive",
            commitMessage: "save",
          }),
          rateLimit: undefined,
        };
      },
    };
    const { ctx } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "file this under networking",
      replyToMessageText: "TCP keepalive should be checked on the LB.",
    });

    await createSaveHandler(baseDeps({ groq }))(ctx);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("TCP keepalive should be checked on the LB.");
    expect(prompt).toContain("file this under networking");
  });

  it("sends a safe error message when the model call fails", async () => {
    const groq = {
      createChatCompletion: async () => {
        throw new Error("boom");
      },
    };
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "a note",
    });

    await createSaveHandler(baseDeps({ groq }))(ctx);

    expect(sendMessageCalls[0].text).toMatch(/something went wrong/i);
    expect(sendMessageCalls[0].text).not.toContain("boom");
  });

  it("propagates a getDocument failure other than not-found instead of silently continuing", async () => {
    const contentProvider = createFakeContentProvider({
      getDocument: async () => {
        throw new Error("network down");
      },
    });
    const groq = {
      createChatCompletion: async () => ({
        text: JSON.stringify({
          action: "write",
          path: "antonio/networking/dns.md",
          isNewFile: false,
          commitMessage: "save",
        }),
        rateLimit: undefined,
      }),
    };
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "update dns notes",
    });

    await createSaveHandler(baseDeps({ contentProvider, groq }))(ctx);
    expect(sendMessageCalls[0].text).toMatch(/something went wrong/i);
  });
});

/** listDirectory result decideSave needs to see "antonio/meeting.md" as an existing (flat) document. */
function contentProviderWithFlatMeeting(
  overrides: Partial<Parameters<typeof createFakeContentProvider>[0]> = {},
) {
  return createFakeContentProvider({
    listDirectory: async () => [
      { type: "document", name: "meeting.md", path: "antonio/meeting.md" },
    ],
    ...overrides,
  });
}

describe("createSaveHandler reorganize proposal", () => {
  it("sends an ask-first confirmation instead of writing anything, when decideSave proposes a reorganize", async () => {
    const { writer, writes, deletes } = createFakeContentWriter();
    const groq = fakeGroqReturning({
      action: "reorganize",
      moveFrom: "antonio/meeting.md",
      moveTo: "antonio/meetings/kickoff.md",
      newPath: "antonio/meetings/sales-call.md",
      content: "# Sales call",
      commitMessage: "save: sales call",
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "add a note about tomorrow's sales call",
    });

    await createSaveHandler(
      baseDeps({
        contentWriter: writer,
        contentProvider: contentProviderWithFlatMeeting(),
        groq,
      }),
    )(ctx);

    expect(writes).toHaveLength(0);
    expect(deletes).toHaveLength(0);
    expect(sendMessageCalls[0].text).toContain("antonio/meeting.md");
    expect(sendMessageCalls[0].keyboard?.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({ text: "✅ Yes, reorganize" }),
    );
  });

  it("executes a reorganize directly on round 2 (after a clarifying answer), with no extra confirmation step", async () => {
    const { writer, writes, deletes } = createFakeContentWriter();
    const contentProvider = contentProviderWithFlatMeeting({
      getDocument: async () => ({
        path: "antonio/meeting.md",
        name: "meeting.md",
        content: "# Meeting\nOriginal notes.",
      }),
    });
    const groq = fakeGroqReturning({
      action: "reorganize",
      moveFrom: "antonio/meeting.md",
      moveTo: "antonio/meetings/kickoff.md",
      newPath: "antonio/meetings/sales-call.md",
      content: "# Sales call\nTomorrow at 3pm.",
      commitMessage: "save: sales call",
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      messageText: "decide yourself",
      replyToMessageText:
        "❓ Need a bit more info to save this:\n1. Which topic?\n\n⎯⎯⎯ save-context (do not edit) ⎯⎯⎯\nsomething about a sales call",
    });

    await createSaveHandler(
      baseDeps({ contentWriter: writer, contentProvider, groq }),
    )(ctx);

    expect(writes.map((w) => w.path)).toEqual([
      "antonio/meetings/sales-call.md",
      "antonio/meetings/kickoff.md",
    ]);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].path).toBe("antonio/meeting.md");
    expect(
      sendMessageCalls[0].keyboard?.inline_keyboard.flat(),
    ).not.toContainEqual(
      expect.objectContaining({ text: "✅ Yes, reorganize" }),
    );
  });
});

/** listDirectory result decideSave needs to see two existing "antonio/meetings/*.md" documents. */
function contentProviderWithTwoMeetingNotes(
  overrides: Partial<Parameters<typeof createFakeContentProvider>[0]> = {},
) {
  return createFakeContentProvider({
    listDirectory: async () => [
      {
        type: "document",
        name: "kickoff.md",
        path: "antonio/meetings/kickoff.md",
      },
      {
        type: "document",
        name: "sales-call.md",
        path: "antonio/meetings/sales-call.md",
      },
    ],
    ...overrides,
  });
}

describe("createSaveHandler delete proposal", () => {
  it("deletes a single file immediately, with no confirmation step", async () => {
    const { writer, writes, deletes } = createFakeContentWriter();
    const groq = fakeGroqReturning({
      action: "delete",
      paths: ["antonio/meetings/kickoff.md"],
      commitMessage: "delete: kickoff note",
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "delete the kickoff meeting note",
    });

    await createSaveHandler(
      baseDeps({
        contentWriter: writer,
        contentProvider: contentProviderWithTwoMeetingNotes(),
        groq,
      }),
    )(ctx);

    expect(writes).toHaveLength(0);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].path).toBe("antonio/meetings/kickoff.md");
    expect(sendMessageCalls[0].text).toContain("antonio/meetings/kickoff.md");
    expect(sendMessageCalls[0].keyboard?.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({ text: "↩️ Undo: kickoff.md" }),
    );
  });

  it("asks for confirmation before deleting 2+ files, and deletes nothing yet", async () => {
    const { writer, writes, deletes } = createFakeContentWriter();
    const groq = fakeGroqReturning({
      action: "delete",
      paths: ["antonio/meetings/kickoff.md", "antonio/meetings/sales-call.md"],
      commitMessage: "delete: clear meetings folder",
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "delete everything in the meetings folder",
    });

    await createSaveHandler(
      baseDeps({
        contentWriter: writer,
        contentProvider: contentProviderWithTwoMeetingNotes(),
        groq,
      }),
    )(ctx);

    expect(writes).toHaveLength(0);
    expect(deletes).toHaveLength(0);
    expect(sendMessageCalls[0].text).toContain("antonio/meetings/kickoff.md");
    expect(sendMessageCalls[0].text).toContain(
      "antonio/meetings/sales-call.md",
    );
    expect(sendMessageCalls[0].keyboard?.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({ text: "🗑️ Yes, delete" }),
    );
  });

  it("executes a multi-file delete directly on round 2, with no confirmation step", async () => {
    const { writer, deletes } = createFakeContentWriter();
    const groq = fakeGroqReturning({
      action: "delete",
      paths: ["antonio/meetings/kickoff.md", "antonio/meetings/sales-call.md"],
      commitMessage: "delete: clear meetings folder",
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      messageText: "yes, delete both",
      replyToMessageText:
        "❓ Need a bit more info to save this:\n1. Which files?\n\n⎯⎯⎯ save-context (do not edit) ⎯⎯⎯\ndelete the old meeting notes",
    });

    await createSaveHandler(
      baseDeps({
        contentWriter: writer,
        contentProvider: contentProviderWithTwoMeetingNotes(),
        groq,
      }),
    )(ctx);

    expect(deletes.map((d) => d.path)).toEqual([
      "antonio/meetings/kickoff.md",
      "antonio/meetings/sales-call.md",
    ]);
    expect(
      sendMessageCalls[0].keyboard?.inline_keyboard.flat(),
    ).not.toContainEqual(expect.objectContaining({ text: "🗑️ Yes, delete" }));
  });
});

describe("createReorganizeConfirmHandler", () => {
  async function proposeReorganize(
    overrides: Partial<SaveDeps> = {},
  ): Promise<string> {
    const groq = fakeGroqReturning({
      action: "reorganize",
      moveFrom: "antonio/meeting.md",
      moveTo: "antonio/meetings/kickoff.md",
      newPath: "antonio/meetings/sales-call.md",
      content: "# Sales call\nTomorrow at 3pm.",
      commitMessage: "save: sales call",
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "add a note about tomorrow's sales call",
    });
    await createSaveHandler(
      baseDeps({
        contentProvider: contentProviderWithFlatMeeting(),
        ...overrides,
        groq,
      }),
    )(ctx);
    return sendMessageCalls[0].text;
  }

  it("confirming moves the existing flat file and writes the new note", async () => {
    const { writer, writes, deletes } = createFakeContentWriter();
    const contentProvider = contentProviderWithFlatMeeting({
      getDocument: async () => ({
        path: "antonio/meeting.md",
        name: "meeting.md",
        content: "# Meeting\nOriginal notes.",
      }),
    });
    const proposalText = await proposeReorganize({
      contentWriter: writer,
      contentProvider,
    });

    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      callbackMessageText: proposalText,
    });
    await createReorganizeConfirmHandler(
      baseDeps({ contentWriter: writer, contentProvider }),
    )(ctx, true);

    expect(writes.map((w) => w.path)).toEqual([
      "antonio/meetings/sales-call.md",
      "antonio/meetings/kickoff.md",
    ]);
    expect(writes[0].content).toBe("# Sales call\nTomorrow at 3pm.");
    expect(writes[1].content).toBe("# Meeting\nOriginal notes.");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].path).toBe("antonio/meeting.md");

    expect(sendMessageCalls[0].text).toContain(
      "antonio/meetings/sales-call.md",
    );
    expect(sendMessageCalls[0].text).toContain("antonio/meeting.md");
    expect(sendMessageCalls[0].text).toContain("antonio/meetings/kickoff.md");
    const undoButtons = (
      sendMessageCalls[0].keyboard?.inline_keyboard.flat() ?? []
    ).filter((b) => b.text.startsWith("↩️ Undo"));
    expect(undoButtons).toHaveLength(3);
  });

  it("declining just writes the new note, leaving the existing flat file untouched", async () => {
    const { writer, writes, deletes } = createFakeContentWriter();
    const contentProvider = contentProviderWithFlatMeeting();
    const proposalText = await proposeReorganize({
      contentWriter: writer,
      contentProvider,
    });

    const { ctx } = createFakeBotContext({
      userId: 712059530,
      callbackMessageText: proposalText,
    });
    await createReorganizeConfirmHandler(
      baseDeps({ contentWriter: writer, contentProvider }),
    )(ctx, false);

    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("antonio/meetings/sales-call.md");
    expect(deletes).toHaveLength(0);
  });

  it("acknowledges the callback immediately", async () => {
    const proposalText = await proposeReorganize();
    const { ctx, answerCallbackQueryCalls } = createFakeBotContext({
      userId: 712059530,
      callbackMessageText: proposalText,
    });

    await createReorganizeConfirmHandler(baseDeps())(ctx, false);

    expect(answerCallbackQueryCalls).toHaveLength(1);
  });

  it("denies a non-editor", async () => {
    const proposalText = await proposeReorganize();
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 999,
      callbackMessageText: proposalText,
    });

    await createReorganizeConfirmHandler(baseDeps())(ctx, true);

    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("shows a friendly message when there's no pending proposal to recover", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      callbackMessageText: "just an ordinary message",
    });

    await createReorganizeConfirmHandler(baseDeps())(ctx, true);

    expect(sendMessageCalls[0].text).toMatch(/no longer available/i);
  });

  it("shows a friendly message when there's no callback message text at all", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
    });

    await createReorganizeConfirmHandler(baseDeps())(ctx, true);

    expect(sendMessageCalls[0].text).toMatch(/no longer available/i);
  });
});

describe("createDeleteConfirmHandler", () => {
  async function proposeDelete(
    overrides: Partial<SaveDeps> = {},
  ): Promise<string> {
    const groq = fakeGroqReturning({
      action: "delete",
      paths: ["antonio/meetings/kickoff.md", "antonio/meetings/sales-call.md"],
      commitMessage: "delete: clear meetings folder",
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      commandArgs: "delete everything in the meetings folder",
    });
    await createSaveHandler(
      baseDeps({
        contentProvider: contentProviderWithTwoMeetingNotes(),
        ...overrides,
        groq,
      }),
    )(ctx);
    return sendMessageCalls[0].text;
  }

  it("confirming deletes every proposed path", async () => {
    const { writer, writes, deletes } = createFakeContentWriter();
    const proposalText = await proposeDelete({ contentWriter: writer });

    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      callbackMessageText: proposalText,
    });
    await createDeleteConfirmHandler(baseDeps({ contentWriter: writer }))(
      ctx,
      true,
    );

    expect(writes).toHaveLength(0);
    expect(deletes.map((d) => d.path)).toEqual([
      "antonio/meetings/kickoff.md",
      "antonio/meetings/sales-call.md",
    ]);
    expect(sendMessageCalls[0].text).toContain("antonio/meetings/kickoff.md");
    const undoButtons = (
      sendMessageCalls[0].keyboard?.inline_keyboard.flat() ?? []
    ).filter((b) => b.text.startsWith("↩️ Undo"));
    expect(undoButtons).toHaveLength(2);
  });

  it("declining deletes nothing", async () => {
    const { writer, deletes } = createFakeContentWriter();
    const proposalText = await proposeDelete({ contentWriter: writer });

    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      callbackMessageText: proposalText,
    });
    await createDeleteConfirmHandler(baseDeps({ contentWriter: writer }))(
      ctx,
      false,
    );

    expect(deletes).toHaveLength(0);
    expect(sendMessageCalls[0].text).toMatch(/cancelled/i);
  });

  it("acknowledges the callback immediately", async () => {
    const proposalText = await proposeDelete();
    const { ctx, answerCallbackQueryCalls } = createFakeBotContext({
      userId: 712059530,
      callbackMessageText: proposalText,
    });

    await createDeleteConfirmHandler(baseDeps())(ctx, false);

    expect(answerCallbackQueryCalls).toHaveLength(1);
  });

  it("denies a non-editor", async () => {
    const proposalText = await proposeDelete();
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 999,
      callbackMessageText: proposalText,
    });

    await createDeleteConfirmHandler(baseDeps())(ctx, true);

    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("denies a proposal whose paths fall outside the caller's own folder", async () => {
    const forgedProposal = `🗑️ Delete 1 file?\n\n⎯⎯⎯ delete-proposal (do not edit) ⎯⎯⎯\n${JSON.stringify(
      { paths: ["someone-else/notes.md"], commitMessage: "delete" },
    )}`;
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      callbackMessageText: forgedProposal,
    });

    await createDeleteConfirmHandler(baseDeps())(ctx, true);

    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("shows a friendly message when there's no pending proposal to recover", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
      callbackMessageText: "just an ordinary message",
    });

    await createDeleteConfirmHandler(baseDeps())(ctx, true);

    expect(sendMessageCalls[0].text).toMatch(/no longer available/i);
  });
});

describe("createSaveFromMessageHandler", () => {
  it("saves the tapped message's own text, acknowledging the callback first", async () => {
    const { writer, writes } = createFakeContentWriter();
    const { ctx, answerCallbackQueryCalls } = createFakeBotContext({
      userId: 712059530,
      callbackData: "a",
      callbackMessageText: "TCP keepalive should be checked on the LB.",
    });

    await createSaveFromMessageHandler(baseDeps({ contentWriter: writer }))(
      ctx,
    );

    expect(answerCallbackQueryCalls).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("antonio/networking/keepalive.md");
  });

  it("denies a non-editor", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 999,
      callbackMessageText: "some answer text",
    });

    await createSaveFromMessageHandler(baseDeps())(ctx);

    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("shows a friendly message when the tapped message is too old to carry its text", async () => {
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
    });

    await createSaveFromMessageHandler(baseDeps())(ctx);

    expect(sendMessageCalls[0].text).toMatch(/too old/i);
  });
});

describe("isSaveClarifyContinuation", () => {
  it("recognizes a reply carrying the save-context marker", () => {
    const { ctx } = createFakeBotContext({
      replyToMessageText: "⎯⎯⎯ save-context (do not edit) ⎯⎯⎯\nfoo",
    });
    expect(isSaveClarifyContinuation(ctx)).toBe(true);
  });

  it("returns false for an ordinary reply or no reply at all", () => {
    const { ctx: withReply } = createFakeBotContext({
      replyToMessageText: "just a normal message",
    });
    expect(isSaveClarifyContinuation(withReply)).toBe(false);

    const { ctx: noReply } = createFakeBotContext();
    expect(isSaveClarifyContinuation(noReply)).toBe(false);
  });
});

describe("createRevertHandler", () => {
  it("reverts a write within the caller's own folder", async () => {
    const { writer, reverts } = createFakeContentWriter();
    const { ctx, updateMessageCalls } = createFakeBotContext({
      userId: 712059530,
    });

    await createRevertHandler(editors, writer)(ctx, {
      path: "antonio/networking/dns.md",
      beforeCommitSha: "abc123",
    });

    expect(reverts).toHaveLength(1);
    expect(reverts[0]).toEqual({
      path: "antonio/networking/dns.md",
      beforeCommitSha: "abc123",
      message: "revert: antonio/networking/dns.md",
    });
    expect(updateMessageCalls[0].text).toMatch(/reverted/i);
  });

  it("denies reverting a path outside the caller's own folder", async () => {
    const { writer, reverts } = createFakeContentWriter();
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
    });

    await createRevertHandler(editors, writer)(ctx, {
      path: "someone-else/notes.md",
      beforeCommitSha: "abc123",
    });

    expect(reverts).toHaveLength(0);
    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("denies a non-editor entirely", async () => {
    const { writer, reverts } = createFakeContentWriter();
    const { ctx, sendMessageCalls } = createFakeBotContext({ userId: 999 });

    await createRevertHandler(editors, writer)(ctx, {
      path: "antonio/networking/dns.md",
      beforeCommitSha: "abc123",
    });

    expect(reverts).toHaveLength(0);
    expect(sendMessageCalls[0].text).toMatch(/private bot/i);
  });

  it("sends a safe error message when the revert itself fails", async () => {
    const { writer } = createFakeContentWriter({
      onRevert: () => {
        throw new ContentNotFoundError("antonio/networking/dns.md");
      },
    });
    const { ctx, sendMessageCalls } = createFakeBotContext({
      userId: 712059530,
    });

    await createRevertHandler(editors, writer)(ctx, {
      path: "antonio/networking/dns.md",
      beforeCommitSha: "abc123",
    });

    expect(sendMessageCalls[0].text).toBeTruthy();
  });
});
