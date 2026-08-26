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
      ? 'This is the second attempt: you already asked a clarifying question and the user answered it. You MUST return "write", "reorganize", or "delete" this time — never "clarify" again, the user has already given you what you asked for. Whichever of those is genuinely right, use it directly — on this attempt it applies immediately without asking again, since the user already gave their input for this round.'
      : "This is the first attempt.";
  const newFileInstruction =
    ctx.verbatimContent !== undefined
      ? 'Otherwise, respond with action "write", a NEW path, and isNewFile: true. Do not include content — this request came from an uploaded file, its exact content is already known separately and will be saved as-is.'
      : 'Otherwise, respond with action "write", a NEW path, isNewFile: true, and the full Markdown content directly. Keep it concise — this is a saved note, not a textbook chapter: a "# Title" line plus a few sentences or bullets is often enough.';

  return `You help maintain a personal Markdown knowledge base for one editor, stored under the folder "${ctx.editorFolder}/". You'll be given a save request (a typed note, or a description alongside uploaded file content) and a list of that editor's existing document paths.

Decide one of:
1. If the request is clear enough, decide where it belongs:
   - If it fits an EXISTING file well (same specific topic), respond with action "write", that exact existing path, and isNewFile: false. Do not include content — you have not seen that file's current content yet, a separate step handles merging it in.
   - ${newFileInstruction}
   - New-file paths MUST use a topic subfolder: "${ctx.editorFolder}/<topic>/<file>.md", never a file directly under "${ctx.editorFolder}/" itself. Pick <topic> from the request's actual subject (e.g. a work meeting note might be "${ctx.editorFolder}/meetings/...", a networking note "${ctx.editorFolder}/networking/..."). If existing documents already establish a topic structure, follow it and reuse a matching topic folder over inventing a near-duplicate one; if there are none yet, choose a sensible topic name yourself — a knowledge base organized by subject is the whole point, so never take the shortcut of skipping the subfolder just because nothing exists yet.
   - Every path must start with "${ctx.editorFolder}/", include at least one subfolder, and end in .md.
2. If the request is for a genuinely NEW, separate note, and its topic clearly overlaps with an EXISTING file that sits directly under "${ctx.editorFolder}/" with NO topic subfolder of its own (i.e. it predates any folder organization), you may instead propose grouping them: respond with action "reorganize", moveFrom (that exact existing flat path), moveTo (a new path for it inside a shared topic subfolder), newPath (a path for the NEW note inside that same subfolder), the new note's full Markdown content, and a commitMessage for the new note. On a first attempt this only proposes the move, shown to the user to confirm before anything happens; on a second attempt (see below) it applies directly. Use it sparingly and only when the two are clearly the same subject; never for a file that's already inside a subfolder, and never when the request is actually just editing that existing file itself (that's still action "write" with isNewFile: false, per #1).
3. If the request is asking to DELETE something — a specific existing file, or an entire topic folder — respond with action "delete", paths (the exact existing document path(s) to remove; for a folder, every existing document listed under it), and a commitMessage. Only ever list paths that already appear in the existing documents list above — never invent one, and never delete something just because it seems related; the request must actually ask for removal.
4. If you genuinely can't tell where this belongs, respond with action "clarify" and 1-3 short, specific questions.

${roundNote}

Respond with ONLY a JSON object matching one of:
{"action":"clarify","questions":["..."]}
{"action":"write","path":"...","isNewFile":true,"content":"...","commitMessage":"..."}
{"action":"write","path":"...","isNewFile":false,"commitMessage":"..."}
{"action":"reorganize","moveFrom":"...","moveTo":"...","newPath":"...","content":"...","commitMessage":"..."}
{"action":"delete","paths":["..."],"commitMessage":"..."}`;
}

// Groq's API rejects an oversized request body outright (413), independent
// of the model's token context window — this bit an uploaded file's full raw
// content once it was embedded here uncapped (see answerQuestion.ts's
// MAX_REFERENCE_DOCUMENT_CHARS for the same failure mode hit earlier). Only
// a preview is needed here for path/topic classification — when this came
// from an upload, the exact original content is saved verbatim regardless
// (see verbatimContent).
const MAX_SAVE_REQUEST_PREVIEW_CHARS = 3000;

function buildUserMessage(ctx: SaveRequestContext): string {
  const entries =
    ctx.existingEntries.length > 0
      ? ctx.existingEntries.join("\n")
      : "(no existing documents yet)";
  const requestPreview =
    ctx.request.length > MAX_SAVE_REQUEST_PREVIEW_CHARS
      ? ctx.request.slice(0, MAX_SAVE_REQUEST_PREVIEW_CHARS) + "…"
      : ctx.request;
  return `Existing documents:\n${entries}\n\nSave request:\n${requestPreview}`;
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

/** Never trust a model-generated path: re-validate and re-derive it, exactly like every other path in this app (see content/paths.ts), and confirm it still starts with the caller's own folder AFTER normalization — a raw string prefix check alone wouldn't catch e.g. "antonio/../other/x.md". */
function normalizeWithinFolder(
  rawPath: string,
  editorFolder: string,
  label: string,
): string {
  let normalized: string;
  try {
    normalized = normalizeRelativePath(rawPath);
  } catch (error) {
    throw new GroqUnavailableError(
      error instanceof InvalidPathError
        ? `Groq proposed an unsafe ${label}path: ${error.message}`
        : `Groq proposed an invalid ${label}path`,
    );
  }
  if (!normalized.startsWith(`${editorFolder}/`)) {
    throw new GroqUnavailableError(
      `Groq proposed a ${label}path outside the editor's folder`,
    );
  }
  if (!hasMarkdownExtension(normalized)) {
    throw new GroqUnavailableError(`Groq proposed a non-Markdown ${label}path`);
  }
  return normalized;
}

/** True when a normalized, in-folder path has no topic subfolder — sits directly at "editorFolder/file.md". */
function isFlatInFolder(normalizedPath: string, editorFolder: string): boolean {
  return !normalizedPath.slice(editorFolder.length + 1).includes("/");
}

function validateWriteDecision(
  data: Extract<SaveDecision, { action: "write" }>,
  ctx: SaveRequestContext,
): SaveDecision {
  if (
    data.isNewFile &&
    data.content === undefined &&
    ctx.verbatimContent === undefined
  ) {
    throw new GroqUnavailableError(
      "Groq marked this a new file but returned no content",
    );
  }
  const normalizedPath = normalizeWithinFolder(data.path, ctx.editorFolder, "");
  // A brand-new file must land in a topic subfolder, never flat under the
  // editor's own top-level folder — otherwise a cold-start editor with no
  // existing entries to pattern-match against tends to dump everything flat.
  // Existing-file paths aren't re-checked here: they're whatever the editor
  // already has, which this function doesn't get to relitigate.
  if (data.isNewFile && isFlatInFolder(normalizedPath, ctx.editorFolder)) {
    throw new GroqUnavailableError(
      "Groq proposed a new file directly under the editor's folder instead of a topic subfolder",
    );
  }
  // An upload's exact original content always wins over whatever the model
  // returned (or was asked not to return) — see SaveRequestContext.verbatimContent.
  const content =
    data.isNewFile && ctx.verbatimContent !== undefined
      ? ctx.verbatimContent
      : data.content;
  return { ...data, path: normalizedPath, content };
}

function validateReorganizeDecision(
  data: Extract<SaveDecision, { action: "reorganize" }>,
  ctx: SaveRequestContext,
): SaveDecision {
  const moveFrom = normalizeWithinFolder(
    data.moveFrom,
    ctx.editorFolder,
    "moveFrom ",
  );
  // Never trust the model to name an arbitrary path to move/delete — it must
  // be one of the editor's actual existing documents, and genuinely flat
  // (the whole point of proposing this).
  if (!ctx.existingEntries.includes(moveFrom)) {
    throw new GroqUnavailableError(
      "Groq proposed reorganizing a path that isn't one of the editor's existing documents",
    );
  }
  if (!isFlatInFolder(moveFrom, ctx.editorFolder)) {
    throw new GroqUnavailableError(
      "Groq proposed reorganizing a file that's already inside a topic subfolder",
    );
  }

  const moveTo = normalizeWithinFolder(
    data.moveTo,
    ctx.editorFolder,
    "moveTo ",
  );
  const newPath = normalizeWithinFolder(
    data.newPath,
    ctx.editorFolder,
    "newPath ",
  );
  if (isFlatInFolder(moveTo, ctx.editorFolder)) {
    throw new GroqUnavailableError(
      "Groq proposed a moveTo path without a topic subfolder",
    );
  }
  if (isFlatInFolder(newPath, ctx.editorFolder)) {
    throw new GroqUnavailableError(
      "Groq proposed a newPath without a topic subfolder",
    );
  }
  if (moveTo === newPath) {
    throw new GroqUnavailableError(
      "Groq proposed the same path for both the moved file and the new note",
    );
  }
  if (moveTo === moveFrom) {
    throw new GroqUnavailableError(
      "Groq proposed moving a file to its own current path",
    );
  }

  return { ...data, moveFrom, moveTo, newPath };
}

function validateDeleteDecision(
  data: Extract<SaveDecision, { action: "delete" }>,
  ctx: SaveRequestContext,
): SaveDecision {
  // Never trust the model to name arbitrary paths to delete — every one
  // must be an exact existing document, re-derived and re-checked exactly
  // like every other model-generated path in this app.
  const normalizedPaths = data.paths.map((rawPath) => {
    const normalized = normalizeWithinFolder(rawPath, ctx.editorFolder, "");
    if (!ctx.existingEntries.includes(normalized)) {
      throw new GroqUnavailableError(
        "Groq proposed deleting a path that isn't one of the editor's existing documents",
      );
    }
    return normalized;
  });

  return { ...data, paths: [...new Set(normalizedPaths)] };
}

/** Decides where a save request belongs, or asks a clarifying question. Never writes, moves, or deletes anything itself — "reorganize" and a multi-path "delete" are only ever proposals for the caller to confirm (see save.ts). */
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
  if (parsed.data.action === "clarify") return parsed.data;
  if (parsed.data.action === "reorganize") {
    return validateReorganizeDecision(parsed.data, ctx);
  }
  if (parsed.data.action === "delete") {
    return validateDeleteDecision(parsed.data, ctx);
  }
  return validateWriteDecision(parsed.data, ctx);
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
