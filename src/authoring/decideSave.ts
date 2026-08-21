import {
  hasMarkdownExtension,
  InvalidPathError,
  normalizeRelativePath,
} from "@/content";
import type { ChatMessage, GroqClient } from "@/rag/groqClient";
import { GroqUnavailableError } from "@/rag/errors";
import {
  composedContentSchema,
  decisionSchema,
  type ComposedContent,
  type SaveDecision,
  type SaveRequestContext,
} from "./types";

type GroqLike = Pick<GroqClient, "createChatCompletion">;

function decideSystemPrompt(ctx: SaveRequestContext): string {
  const roundNote =
    ctx.clarifyRound > 0
      ? 'This is the second attempt: you already asked a clarifying question. You MUST return "write" this time — make your best reasonable guess rather than asking again.'
      : "This is the first attempt.";

  return `You help maintain a personal Markdown knowledge base for one editor, stored under the folder "${ctx.editorFolder}/". You'll be given a save request (a typed note, or a description alongside uploaded file content) and a list of that editor's existing document paths.

Decide one of:
1. If the request is clear enough, decide where it belongs:
   - If it fits an EXISTING file well (same specific topic), respond with action "write", that exact existing path, and isNewFile: false. Do not include content — you have not seen that file's current content yet, a separate step handles merging it in.
   - Otherwise, respond with action "write", a NEW path following the existing folder/topic structure (or a sensible new topic subfolder if none fits), isNewFile: true, and the full Markdown content directly. Keep it concise — this is a saved note, not a textbook chapter: a "# Title" line plus a few sentences or bullets is often enough.
   - Every path must start with "${ctx.editorFolder}/" and end in .md.
2. If you genuinely can't tell where this belongs, respond with action "clarify" and 1-3 short, specific questions.

${roundNote}

Respond with ONLY a JSON object matching one of:
{"action":"clarify","questions":["..."]}
{"action":"write","path":"...","isNewFile":true,"content":"...","commitMessage":"..."}
{"action":"write","path":"...","isNewFile":false,"commitMessage":"..."}`;
}

function buildUserMessage(ctx: SaveRequestContext): string {
  const entries =
    ctx.existingEntries.length > 0
      ? ctx.existingEntries.join("\n")
      : "(no existing documents yet)";
  return `Existing documents:\n${entries}\n\nSave request:\n${ctx.request}`;
}

async function callGroqJson(
  groq: GroqLike,
  messages: ChatMessage[],
): Promise<unknown> {
  const { text } = await groq.createChatCompletion(messages, {
    reasoningEffort: "low",
    jsonMode: true,
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new GroqUnavailableError("Groq returned non-JSON output");
  }
}

/** Decides where a save request belongs, or asks a clarifying question. Never writes anything itself. */
export async function decideSave(
  ctx: SaveRequestContext,
  groq: GroqLike,
): Promise<SaveDecision> {
  const json = await callGroqJson(groq, [
    { role: "system", content: decideSystemPrompt(ctx) },
    { role: "user", content: buildUserMessage(ctx) },
  ]);

  const parsed = decisionSchema.safeParse(json);
  if (!parsed.success) {
    throw new GroqUnavailableError(
      "Groq returned an unexpected save-decision shape",
    );
  }
  if (parsed.data.action !== "write") return parsed.data;
  if (parsed.data.isNewFile && parsed.data.content === undefined) {
    throw new GroqUnavailableError(
      "Groq marked this a new file but returned no content",
    );
  }

  // Never trust a model-generated path: re-validate and re-derive it, exactly
  // like every other path in this app (see content/paths.ts), and confirm it
  // still starts with the caller's own folder AFTER normalization — a raw
  // string prefix check alone wouldn't catch e.g. "antonio/../other/x.md".
  let normalizedPath: string;
  try {
    normalizedPath = normalizeRelativePath(parsed.data.path);
  } catch (error) {
    throw new GroqUnavailableError(
      error instanceof InvalidPathError
        ? `Groq proposed an unsafe path: ${error.message}`
        : "Groq proposed an invalid path",
    );
  }
  if (!normalizedPath.startsWith(`${ctx.editorFolder}/`)) {
    throw new GroqUnavailableError(
      "Groq proposed a path outside the editor's folder",
    );
  }
  if (!hasMarkdownExtension(normalizedPath)) {
    throw new GroqUnavailableError("Groq proposed a non-Markdown path");
  }

  return { ...parsed.data, path: normalizedPath };
}

const COMPOSE_SYSTEM_PROMPT = `You are updating an existing file in a personal Markdown knowledge base. You'll be given the file's current content and new material to incorporate. Merge the new material in naturally (a new section, or extending an existing one) without discarding anything already there unless the new material clearly supersedes it. Preserve the existing heading style.

Respond with ONLY a JSON object: {"content":"<the file's full new content>","commitMessage":"<short commit message>"}`;

/** Merges new material into an existing file's current content, producing the file's full new content. */
export async function composeUpdate(
  existingContent: string,
  request: string,
  groq: GroqLike,
): Promise<ComposedContent> {
  const json = await callGroqJson(groq, [
    { role: "system", content: COMPOSE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Current file content:\n${existingContent}\n\nNew material to incorporate:\n${request}`,
    },
  ]);

  const parsed = composedContentSchema.safeParse(json);
  if (!parsed.success) {
    throw new GroqUnavailableError(
      "Groq returned an unexpected compose-update shape",
    );
  }
  return parsed.data;
}
