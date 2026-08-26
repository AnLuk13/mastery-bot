import type { ContentProvider } from "@/content";
import { ContentNotFoundError } from "@/content";
import type { EditorConfig } from "@/lib/env";
import type { GroqClient } from "@/rag/groqClient";
import { composeUpdate, decideSave } from "@/authoring/decideSave";
import type { SessionStore } from "@/session";
import type { RevertTarget } from "../callbackData";
import { findEditorFolder } from "../auth";
import {
  buildDeleteConfirmKeyboard,
  buildDeleteResultKeyboard,
  buildReorganizeConfirmKeyboard,
  buildReorganizeResultKeyboard,
  buildSaveResultKeyboard,
} from "../keyboards/save";
import type { BotContext } from "../types";
import {
  ACCESS_DENIED_MESSAGE,
  describeSaveError,
  extractClarifyContext,
  extractDeleteProposal,
  extractReorganizeProposal,
  formatClarifyPrompt,
  formatDeleteConfirmPrompt,
  formatDeleteSuccess,
  formatReorganizePrompt,
  formatReorganizeSuccess,
  formatRevertSuccess,
  formatSaveSuccess,
  isClarifyContinuation,
  SAVE_USAGE_MESSAGE,
  UNSUPPORTED_SAVE_FILE_MESSAGE,
  type DeleteProposal,
  type ReorganizeProposal,
} from "../userMessages";

function basename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1];
}

export interface ContentWriterLike {
  write(
    path: string,
    content: string,
    message: string,
  ): Promise<{ path: string; beforeCommitSha: string }>;
  delete(
    path: string,
    message: string,
  ): Promise<{ path: string; beforeCommitSha: string }>;
  revert(path: string, beforeCommitSha: string, message: string): Promise<void>;
}

export interface SaveDeps {
  editors: readonly EditorConfig[];
  contentProvider: ContentProvider;
  contentWriter: ContentWriterLike;
  groq: Pick<GroqClient, "createChatCompletion">;
  sessionStore: SessionStore;
}

const MAX_LISTED_ENTRIES = 300;

/** Shallow-first bounded walk of an editor's folder, for decideSave() to see what already exists. */
async function listEditorEntries(
  provider: ContentProvider,
  folder: string,
): Promise<string[]> {
  const paths: string[] = [];

  async function walk(dirPath: string): Promise<void> {
    if (paths.length >= MAX_LISTED_ENTRIES) return;
    let entries;
    try {
      entries = await provider.listDirectory(dirPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (paths.length >= MAX_LISTED_ENTRIES) return;
      if (entry.type === "document") {
        paths.push(entry.path);
      } else {
        await walk(entry.path);
      }
    }
  }

  await walk(folder);
  return paths;
}

function isSupportedSaveFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".txt") || lower.endsWith(".md");
}

/** True when this incoming plain-text message is a reply continuing a prior save-clarify prompt. */
export function isSaveClarifyContinuation(ctx: BotContext): boolean {
  return isClarifyContinuation(ctx.replyToMessageText);
}

/** Writes a single file and reports success — the common tail of every non-reorganize save path. */
async function writeAndReport(
  ctx: BotContext,
  deps: SaveDeps,
  path: string,
  content: string,
  commitMessage: string,
): Promise<void> {
  const result = await deps.contentWriter.write(path, content, commitMessage);
  const keyboard = buildSaveResultKeyboard(result.path, result.beforeCommitSha);
  await ctx.sendMessage(formatSaveSuccess(result.path, content), keyboard);
}

/**
 * Actually performs a reorganize: writes the new note, copies the existing
 * flat file's current content to its new topic-folder home, then deletes
 * the old path — each as its own commit, each independently revertible.
 * Shared by the confirm-button flow (see createReorganizeConfirmHandler)
 * and the round-2 direct-execution path in performSave below.
 */
async function executeReorganize(
  ctx: BotContext,
  deps: SaveDeps,
  proposal: ReorganizeProposal,
): Promise<void> {
  const newResult = await deps.contentWriter.write(
    proposal.newPath,
    proposal.content,
    proposal.commitMessage,
  );
  const existingDoc = await deps.contentProvider.getDocument(proposal.moveFrom);
  const moveMessage = `reorganize: move ${proposal.moveFrom} to ${proposal.moveTo}`;
  const moveResult = await deps.contentWriter.write(
    proposal.moveTo,
    existingDoc.content,
    moveMessage,
  );
  const deleteResult = await deps.contentWriter.delete(
    proposal.moveFrom,
    moveMessage,
  );

  const keyboard = buildReorganizeResultKeyboard([
    {
      label: basename(newResult.path),
      path: newResult.path,
      beforeCommitSha: newResult.beforeCommitSha,
      viewable: true,
    },
    {
      label: basename(moveResult.path),
      path: moveResult.path,
      beforeCommitSha: moveResult.beforeCommitSha,
      viewable: true,
    },
    {
      label: `restore ${basename(deleteResult.path)}`,
      path: deleteResult.path,
      beforeCommitSha: deleteResult.beforeCommitSha,
      viewable: false,
    },
  ]);
  await ctx.sendMessage(formatReorganizeSuccess(proposal), keyboard);
}

/**
 * Actually performs a delete: removes every path in the proposal, each as
 * its own commit, each independently revertible (revert() recreates a
 * deleted file exactly like it undoes any other write — see
 * GitHubContentWriter). Shared by the confirm-button flow (see
 * createDeleteConfirmHandler) and the immediate-execution paths in
 * performSave below (a single file, or 2+ files on round 2+).
 */
async function executeDelete(
  ctx: BotContext,
  deps: SaveDeps,
  proposal: DeleteProposal,
): Promise<void> {
  const results = [];
  for (const path of proposal.paths) {
    results.push(await deps.contentWriter.delete(path, proposal.commitMessage));
  }

  const keyboard = buildDeleteResultKeyboard(
    results.map((result) => ({
      label: basename(result.path),
      path: result.path,
      beforeCommitSha: result.beforeCommitSha,
    })),
  );
  await ctx.sendMessage(
    formatDeleteSuccess(results.map((result) => result.path)),
    keyboard,
  );
}

/** Shared core of every save path: decide where the request belongs, merge or write it, and report the result. Never throws — errors are reported to the user as a safe message. */
async function performSave(
  ctx: BotContext,
  deps: SaveDeps,
  folder: string,
  request: string,
  clarifyRound: number,
  verbatimContent?: string,
): Promise<void> {
  await ctx.sendTyping();

  try {
    const existingEntries = await listEditorEntries(
      deps.contentProvider,
      folder,
    );
    const decision = await decideSave(
      {
        editorFolder: folder,
        request,
        existingEntries,
        clarifyRound,
        verbatimContent,
      },
      deps.groq,
    );

    if (decision.action === "clarify") {
      // Stored server-side so a large uploaded file's content survives the
      // round-trip uncapped — see Session.pendingSaveRequest. The message
      // itself still echoes a truncated copy too, as a fallback for when
      // session storage isn't configured.
      if (ctx.userId !== undefined) {
        const session = await deps.sessionStore.get(ctx.userId);
        await deps.sessionStore.set(ctx.userId, {
          ...session,
          pendingSaveRequest: request,
        });
      }
      await ctx.sendMessage(formatClarifyPrompt(decision.questions, request));
      return;
    }

    if (decision.action === "reorganize") {
      if (clarifyRound > 0) {
        // The user already answered one clarifying round — that reply IS
        // their go-ahead. Asking again with Yes/No here would be a second
        // confirmation step right when the save should just happen, so
        // this executes directly instead of proposing.
        await executeReorganize(ctx, deps, decision);
        return;
      }
      // First attempt: ask first — this only ever proposes the move;
      // nothing writes or moves until the user taps Yes (see
      // createReorganizeConfirmHandler).
      await ctx.sendMessage(
        formatReorganizePrompt(decision),
        buildReorganizeConfirmKeyboard(),
      );
      return;
    }

    if (decision.action === "delete") {
      if (decision.paths.length > 1 && clarifyRound === 0) {
        // Several files vanishing in one request is a bigger blast radius
        // than any other single save action produces — ask first, same
        // reasoning as reorganize's first-attempt confirmation.
        await ctx.sendMessage(
          formatDeleteConfirmPrompt(decision),
          buildDeleteConfirmKeyboard(),
        );
        return;
      }
      // A single file deletes immediately, same as any other save action —
      // and 2+ files on round 2 execute directly too, since the user's
      // answer to the clarifying question already is their go-ahead.
      await executeDelete(ctx, deps, decision);
      return;
    }

    let content: string;
    let commitMessage: string;
    if (decision.isNewFile) {
      // decideSave() guarantees content is set when isNewFile is true.
      content = decision.content as string;
      commitMessage = decision.commitMessage;
    } else {
      let existingContent = "";
      try {
        const doc = await deps.contentProvider.getDocument(decision.path);
        existingContent = doc.content;
      } catch (error) {
        if (!(error instanceof ContentNotFoundError)) throw error;
      }
      const composed = await composeUpdate(existingContent, request, deps.groq);
      content = composed.content;
      commitMessage = composed.commitMessage;
    }

    await writeAndReport(ctx, deps, decision.path, content, commitMessage);
  } catch (error) {
    console.error("Save failed:", error);
    await ctx.sendMessage(describeSaveError(error));
  }
}

export function createSaveHandler(deps: SaveDeps) {
  return async (ctx: BotContext): Promise<void> => {
    const folder = findEditorFolder(ctx.userId, deps.editors);
    if (folder === undefined) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    let request: string;
    let clarifyRound: number;

    if (ctx.document) {
      if (!isSupportedSaveFile(ctx.document.fileName)) {
        await ctx.sendMessage(UNSUPPORTED_SAVE_FILE_MESSAGE);
        return;
      }
      let fileContent: string;
      try {
        fileContent = await ctx.downloadDocument(ctx.document.fileId);
      } catch {
        await ctx.sendMessage("⚠️ Couldn't read that file. Please try again.");
        return;
      }
      request = `Uploaded file "${ctx.document.fileName}":\n${fileContent}`;
      clarifyRound = 0;
      await performSave(ctx, deps, folder, request, clarifyRound, fileContent);
      return;
    } else if (isClarifyContinuation(ctx.replyToMessageText)) {
      // Prefer the full, uncapped original stored server-side (see
      // Session.pendingSaveRequest) — falls back to the message's own
      // (truncated) echo only if session storage isn't configured.
      const stored =
        ctx.userId !== undefined
          ? (await deps.sessionStore.get(ctx.userId)).pendingSaveRequest
          : undefined;
      const original =
        stored ?? extractClarifyContext(ctx.replyToMessageText ?? "");
      const answer = (ctx.messageText ?? "").trim();
      request = `${original}\n\nAdditional info from the user:\n${answer}`;
      clarifyRound = 1;
    } else if (ctx.replyToMessageText !== undefined) {
      // /save used as a reply to an earlier message (e.g. a prior /ask
      // answer) — save that message's content, optionally refined by
      // whatever was typed alongside /save.
      const typed = (ctx.commandArgs ?? "").trim();
      request = typed
        ? `${ctx.replyToMessageText}\n\nAdditional instructions from the user:\n${typed}`
        : ctx.replyToMessageText;
      clarifyRound = 0;
    } else {
      const text = (ctx.commandArgs ?? "").trim();
      if (text === "") {
        await ctx.sendMessage(SAVE_USAGE_MESSAGE);
        return;
      }
      request = text;
      clarifyRound = 0;
    }

    await performSave(ctx, deps, folder, request, clarifyRound);
  };
}

/**
 * Handles a tap on an /ask answer's "Save this" button (see keyboards/ask.ts)
 * — the one-tap fix for the confusing case where a user asks the bot to
 * "edit" or "add" something conversationally, gets a fluent-sounding answer
 * back, and assumes it was persisted when /ask never writes anything on its
 * own. Sources its request from the tapped message's own text rather than a
 * reply, since a button tap isn't a reply.
 */
export function createSaveFromMessageHandler(deps: SaveDeps) {
  return async (ctx: BotContext): Promise<void> => {
    // Acknowledge before any slow work, same as every other callback handler.
    await ctx.answerCallbackQuery();

    const folder = findEditorFolder(ctx.userId, deps.editors);
    if (folder === undefined) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    const request = ctx.callbackMessageText;
    if (!request) {
      await ctx.sendMessage(
        "⚠️ That message is too old to save this way — reply to it with /save instead.",
      );
      return;
    }

    await performSave(ctx, deps, folder, request, 0);
  };
}

/**
 * Handles a tap on a reorganize proposal's Yes/No buttons (see
 * userMessages.ts's formatReorganizePrompt). Confirming moves the existing
 * flat file into its new topic folder and writes the new note; declining
 * just writes the new note where it was headed anyway (already a proper
 * topic subfolder — see decideSave's write-path validation) and leaves the
 * old file untouched. Every path is re-validated against the CALLER's own
 * folder here regardless of what the echoed proposal claims — that text
 * round-tripped through a Telegram message and is untrusted input, same as
 * callback_data.
 */
export function createReorganizeConfirmHandler(deps: SaveDeps) {
  return async (ctx: BotContext, confirmed: boolean): Promise<void> => {
    await ctx.answerCallbackQuery();

    const folder = findEditorFolder(ctx.userId, deps.editors);
    if (folder === undefined) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    const proposal = ctx.callbackMessageText
      ? extractReorganizeProposal(ctx.callbackMessageText)
      : undefined;
    if (!proposal) {
      await ctx.sendMessage(
        "⚠️ That proposal is no longer available — please /save again.",
      );
      return;
    }
    if (
      !proposal.moveFrom.startsWith(`${folder}/`) ||
      !proposal.moveTo.startsWith(`${folder}/`) ||
      !proposal.newPath.startsWith(`${folder}/`)
    ) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    try {
      if (!confirmed) {
        await writeAndReport(
          ctx,
          deps,
          proposal.newPath,
          proposal.content,
          proposal.commitMessage,
        );
        return;
      }

      await executeReorganize(ctx, deps, proposal);
    } catch (error) {
      console.error("Reorganize confirm failed:", error);
      await ctx.sendMessage(describeSaveError(error));
    }
  };
}

/**
 * Handles a tap on a multi-file delete proposal's Yes/No buttons (see
 * userMessages.ts's formatDeleteConfirmPrompt). Confirming removes every
 * proposed path; declining leaves everything untouched. Every path is
 * re-validated against the CALLER's own folder here regardless of what the
 * echoed proposal claims — that text round-tripped through a Telegram
 * message and is untrusted input, same as callback_data.
 */
export function createDeleteConfirmHandler(deps: SaveDeps) {
  return async (ctx: BotContext, confirmed: boolean): Promise<void> => {
    await ctx.answerCallbackQuery();

    const folder = findEditorFolder(ctx.userId, deps.editors);
    if (folder === undefined) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    const proposal = ctx.callbackMessageText
      ? extractDeleteProposal(ctx.callbackMessageText)
      : undefined;
    if (!proposal) {
      await ctx.sendMessage(
        "⚠️ That proposal is no longer available — please /save again.",
      );
      return;
    }
    if (!proposal.paths.every((path) => path.startsWith(`${folder}/`))) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    if (!confirmed) {
      await ctx.sendMessage("❌ Cancelled — nothing was deleted.");
      return;
    }

    try {
      await executeDelete(ctx, deps, proposal);
    } catch (error) {
      console.error("Delete confirm failed:", error);
      await ctx.sendMessage(describeSaveError(error));
    }
  };
}

export function createRevertHandler(
  editors: readonly EditorConfig[],
  contentWriter: Pick<ContentWriterLike, "revert">,
) {
  return async (ctx: BotContext, target: RevertTarget): Promise<void> => {
    await ctx.answerCallbackQuery();

    const folder = findEditorFolder(ctx.userId, editors);
    if (folder === undefined || !target.path.startsWith(`${folder}/`)) {
      await ctx.sendMessage(ACCESS_DENIED_MESSAGE);
      return;
    }

    try {
      await contentWriter.revert(
        target.path,
        target.beforeCommitSha,
        `revert: ${target.path}`,
      );
      await ctx.updateMessage(formatRevertSuccess(target.path));
    } catch (error) {
      console.error("Revert failed:", error);
      await ctx.sendMessage(describeSaveError(error));
    }
  };
}
