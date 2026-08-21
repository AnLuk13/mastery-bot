import { z } from "zod";

/** Everything decideSave() needs about the request; the handler assembles this from Telegram + ContentProvider. */
export interface SaveRequestContext {
  /** Top-level folder this editor's writes are confined to (from EDITORS). */
  editorFolder: string;
  /** The typed note, or a description alongside uploaded file content. */
  request: string;
  /** Canonical paths of this editor's existing documents, for the model to fit new material into existing structure. */
  existingEntries: readonly string[];
  /** 0 on a fresh request; 1 after one round of clarifying questions has already been asked. */
  clarifyRound: number;
}

const clarifySchema = z.object({
  action: z.literal("clarify"),
  questions: z.array(z.string().min(1)).min(1).max(3),
});

// A single "write" branch (Zod's discriminatedUnion requires a unique
// discriminator value per branch): `content` is required when isNewFile is
// true (fresh content, nothing to merge) and absent when false (the handler
// fetches the existing file and a separate composeUpdate() call merges it).
// The isNewFile <-> content correlation is checked by decideSave() itself,
// not here, since discriminatedUnion branches must stay plain objects.
const writeSchema = z.object({
  action: z.literal("write"),
  path: z.string().min(1),
  isNewFile: z.boolean(),
  content: z.string().min(1).optional(),
  commitMessage: z.string().min(1),
});

// Proposes grouping a genuinely new, related note together with an existing
// flat file (one with no topic subfolder yet) rather than leaving them split
// across two locations. Never executed directly — decideSave() only ever
// *proposes* this; the caller shows it to the user for confirmation before
// anything moves (see save.ts's reorganize-confirm flow).
const reorganizeSchema = z.object({
  action: z.literal("reorganize"),
  /** The existing flat file to move. */
  moveFrom: z.string().min(1),
  /** Where that existing file should live once grouped into a topic subfolder. */
  moveTo: z.string().min(1),
  /** Where the new note should live, inside that same subfolder. */
  newPath: z.string().min(1),
  content: z.string().min(1),
  commitMessage: z.string().min(1),
});

const decisionSchema = z.discriminatedUnion("action", [
  clarifySchema,
  writeSchema,
  reorganizeSchema,
]);

export type SaveDecision = z.infer<typeof decisionSchema>;
export { decisionSchema };

const composedContentSchema = z.object({
  content: z.string().min(1),
  commitMessage: z.string().min(1),
});

export type ComposedContent = z.infer<typeof composedContentSchema>;
export { composedContentSchema };
