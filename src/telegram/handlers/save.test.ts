import { describe, expect, it } from "vitest";
import { ContentNotFoundError } from "@/content";
import type { EditorConfig } from "@/lib/env";
import {
  createFakeBotContext,
  createFakeContentProvider,
  createFakeContentWriter,
} from "../testHelpers";
import {
  createRevertHandler,
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
