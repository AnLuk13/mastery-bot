import { InlineKeyboard } from "grammy";
import {
  ContentNotFoundError,
  isPathVisible,
  type CommitInfo,
  type ContentProvider,
  type PrivateFolderConfig,
} from "@/content";
import { encodeNavigateCallbackData, type CleanupHint } from "../callbackData";
import { buildDirectoryKeyboard } from "../keyboards/navigation";
import type { BotContext } from "../types";
import { describeContentError, formatCommitLine } from "../userMessages";

const homeOnlyKeyboard = new InlineKeyboard().text(
  "🏠 Home",
  encodeNavigateCallbackData("directory", ""),
);

/**
 * Best-effort: only GitHubContentProvider implements getLatestCommit (see
 * ContentProvider), and even there a network hiccup shouldn't turn "open a
 * folder" into an error — the title still renders fine without it.
 */
async function fetchLatestCommit(
  provider: ContentProvider,
  canonicalPath: string,
): Promise<CommitInfo | undefined> {
  try {
    return await provider.getLatestCommit?.(canonicalPath);
  } catch {
    return undefined;
  }
}

function directoryTitle(
  canonicalPath: string,
  commit: CommitInfo | undefined,
): string {
  if (canonicalPath === "") return "📚 Mastery";
  const segments = canonicalPath.split("/");
  const title = `📁 ${segments[segments.length - 1]}`;
  return commit ? `${title}\n${formatCommitLine(commit)}` : title;
}

const MAX_ROOT_COLLAPSE_DEPTH = 10;

async function listVisible(
  provider: ContentProvider,
  path: string,
  userId: number | undefined,
  privateFolders: readonly PrivateFolderConfig[],
) {
  return (await provider.listDirectory(path)).filter((entry) =>
    isPathVisible(entry.path, userId, privateFolders),
  );
}

/**
 * At root only: if everything the user can see collapses to a single
 * top-level folder (their own, in the common case where PRIVATE_FOLDERS
 * hides everyone else's), skip making them tap into it — show its contents
 * directly. Keeps the "📚 Mastery" title and root-style keyboard (Search, no
 * Back/Home) throughout, since this is still conceptually home.
 */
async function resolveRootEntries(
  provider: ContentProvider,
  userId: number | undefined,
  privateFolders: readonly PrivateFolderConfig[],
) {
  let entries = await listVisible(provider, "", userId, privateFolders);
  for (
    let depth = 0;
    depth < MAX_ROOT_COLLAPSE_DEPTH &&
    entries.length === 1 &&
    entries[0].type === "directory";
    depth++
  ) {
    entries = await listVisible(
      provider,
      entries[0].path,
      userId,
      privateFolders,
    );
  }
  return entries;
}

export async function renderDirectory(
  ctx: BotContext,
  provider: ContentProvider,
  canonicalPath: string,
  privateFolders: readonly PrivateFolderConfig[],
  cleanup?: CleanupHint,
): Promise<void> {
  // Acknowledge before doing any slow work (GitHub fetch, message edit): Telegram
  // expires a callback query after a short window, and answering late causes it to
  // retry-deliver the update, compounding the delay. See webhookHandler design notes.
  await ctx.answerCallbackQuery();

  if (cleanup) {
    await ctx.deleteMessages(cleanup.firstMessageId, cleanup.count);
  }

  try {
    // Same "not found", not a distinct "forbidden" message, for a path someone
    // isn't allowed to see — never reveal that a private path even exists.
    if (!isPathVisible(canonicalPath, ctx.userId, privateFolders)) {
      throw new ContentNotFoundError(canonicalPath);
    }
    const [entries, commit] = await Promise.all([
      canonicalPath === ""
        ? resolveRootEntries(provider, ctx.userId, privateFolders)
        : listVisible(provider, canonicalPath, ctx.userId, privateFolders),
      // No single meaningful path to attach a commit to at the (possibly
      // collapsed) root — see directoryTitle, which never shows one there.
      canonicalPath === ""
        ? Promise.resolve(undefined)
        : fetchLatestCommit(provider, canonicalPath),
    ]);
    const keyboard = buildDirectoryKeyboard(entries, canonicalPath);
    await ctx.updateMessage(directoryTitle(canonicalPath, commit), keyboard);
  } catch (error) {
    await ctx.updateMessage(describeContentError(error), homeOnlyKeyboard);
  }
}

export function createDirectoryCallbackHandler(
  provider: ContentProvider,
  privateFolders: readonly PrivateFolderConfig[],
) {
  return async (
    ctx: BotContext,
    canonicalPath: string,
    cleanup?: CleanupHint,
  ): Promise<void> => {
    await renderDirectory(
      ctx,
      provider,
      canonicalPath,
      privateFolders,
      cleanup,
    );
  };
}
