import type { ContentProvider } from "@/content";
import { ContentNotFoundError } from "@/content";
import type { EditorConfig } from "@/lib/env";
import type { GroqClient } from "@/rag/groqClient";
import { composeUpdate, decideSave } from "@/authoring/decideSave";
import type { RevertTarget } from "../callbackData";
import { findEditorFolder } from "../auth";
import { buildSaveResultKeyboard } from "../keyboards/save";
import type { BotContext } from "../types";
import {
  ACCESS_DENIED_MESSAGE,
  describeSaveError,
  extractClarifyContext,
  formatClarifyPrompt,
  formatRevertSuccess,
  formatSaveSuccess,
  isClarifyContinuation,
  SAVE_USAGE_MESSAGE,
  UNSUPPORTED_SAVE_FILE_MESSAGE,
} from "../userMessages";

export interface ContentWriterLike {
  write(
    path: string,
    content: string,
    message: string,
  ): Promise<{ path: string; beforeCommitSha: string }>;
  revert(path: string, beforeCommitSha: string, message: string): Promise<void>;
}

export interface SaveDeps {
  editors: readonly EditorConfig[];
  contentProvider: ContentProvider;
  contentWriter: ContentWriterLike;
  groq: Pick<GroqClient, "createChatCompletion">;
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
    } else if (isClarifyContinuation(ctx.replyToMessageText)) {
      const original = extractClarifyContext(ctx.replyToMessageText ?? "");
      const answer = (ctx.messageText ?? "").trim();
      request = `${original}\n\nAdditional info from the user:\n${answer}`;
      clarifyRound = 1;
    } else {
      const text = (ctx.commandArgs ?? "").trim();
      if (text === "") {
        await ctx.sendMessage(SAVE_USAGE_MESSAGE);
        return;
      }
      request = text;
      clarifyRound = 0;
    }

    await ctx.sendTyping();

    try {
      const existingEntries = await listEditorEntries(
        deps.contentProvider,
        folder,
      );
      const decision = await decideSave(
        { editorFolder: folder, request, existingEntries, clarifyRound },
        deps.groq,
      );

      if (decision.action === "clarify") {
        await ctx.sendMessage(formatClarifyPrompt(decision.questions, request));
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
        const composed = await composeUpdate(
          existingContent,
          request,
          deps.groq,
        );
        content = composed.content;
        commitMessage = composed.commitMessage;
      }

      const result = await deps.contentWriter.write(
        decision.path,
        content,
        commitMessage,
      );
      const keyboard = buildSaveResultKeyboard(
        result.path,
        result.beforeCommitSha,
      );
      await ctx.sendMessage(formatSaveSuccess(result.path, content), keyboard);
    } catch (error) {
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
      await ctx.sendMessage(describeSaveError(error));
    }
  };
}
