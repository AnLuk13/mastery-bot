import { z } from "zod";
import { normalizeRelativePath, type PrivateFolderConfig } from "@/content";

const csvUserIds = z
  .string()
  .min(1, "must not be empty")
  .transform((value) => value.split(",").map((part) => part.trim()))
  .pipe(
    z.array(
      z
        .string()
        .regex(/^\d+$/, "must be a numeric Telegram user id")
        .transform(Number),
    ),
  );

export interface EditorConfig {
  userId: number;
  /** A single safe path segment: the top-level folder this editor's /save writes are confined to. */
  folder: string;
}

const editorEntry = z
  .string()
  .regex(
    /^\d+:.+$/,
    "each entry must be formatted as <telegram-user-id>:<folder-name>",
  )
  .transform((entry, ctx): EditorConfig => {
    const separatorIndex = entry.indexOf(":");
    const userId = Number(entry.slice(0, separatorIndex));
    const folder = entry.slice(separatorIndex + 1);

    try {
      const normalized = normalizeRelativePath(folder);
      if (normalized === "" || normalized.includes("/")) {
        throw new Error("must be a single folder name, not a nested path");
      }
      return { userId, folder: normalized };
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: `invalid folder in "${entry}": ${error instanceof Error ? error.message : "invalid"}`,
      });
      return z.NEVER;
    }
  });

// Comma-separated <telegram-user-id>:<folder-name> pairs. Optional and empty by
// default: /save is entirely inactive for a deployment that doesn't configure it.
const editorsSchema = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  )
  .pipe(z.array(editorEntry));

const privateFolderEntry = z
  .string()
  .regex(
    /^.+:\d+$/,
    "each entry must be formatted as <folder-name>:<telegram-user-id>",
  )
  .transform((entry, ctx): PrivateFolderConfig => {
    const separatorIndex = entry.lastIndexOf(":");
    const folderRaw = entry.slice(0, separatorIndex);
    const ownerId = Number(entry.slice(separatorIndex + 1));

    try {
      const normalized = normalizeRelativePath(folderRaw);
      if (normalized === "" || normalized.includes("/")) {
        throw new Error("must be a single top-level folder name");
      }
      return { folder: normalized, ownerId };
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: `invalid folder in "${entry}": ${error instanceof Error ? error.message : "invalid"}`,
      });
      return z.NEVER;
    }
  });

// Comma-separated <folder-name>:<telegram-user-id> pairs — a top-level folder
// visible only to its owner. Independent of EDITORS: a folder can be private
// without being anyone's /save target (e.g. legacy content), or vice versa.
const privateFoldersSchema = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  )
  .pipe(z.array(privateFolderEntry));

const baseSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "is required"),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1, "is required"),
  // Deliberately separate from TELEGRAM_WEBHOOK_SECRET: that one is sent BY Telegram on
  // every update, this one is used BY the operator to reconfigure the webhook itself.
  TELEGRAM_SETUP_SECRET: z.string().min(1, "is required"),
  ALLOWED_TELEGRAM_USER_IDS: csvUserIds,
  CONTENT_PROVIDER: z.enum(["local", "github"]),
  CONTENT_ROOT: z.string().optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_REPOSITORY: z.string().optional(),
  GITHUB_BRANCH: z.string().min(1).default("main"),
  GITHUB_CONTENT_PATH: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GROQ_API_KEY: z.string().min(1, "is required"),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
  EDITORS: editorsSchema,
  PRIVATE_FOLDERS: privateFoldersSchema,
});

const envSchema = baseSchema.superRefine((value, ctx) => {
  if (value.CONTENT_PROVIDER === "local" && !value.CONTENT_ROOT) {
    ctx.addIssue({
      code: "custom",
      path: ["CONTENT_ROOT"],
      message: "is required when CONTENT_PROVIDER=local",
    });
  }

  if (value.CONTENT_PROVIDER === "github") {
    for (const key of ["GITHUB_OWNER", "GITHUB_REPOSITORY"] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "is required when CONTENT_PROVIDER=github",
        });
      }
    }
    // GITHUB_CONTENT_PATH may be an empty string, meaning content lives at the repo root.
    if (value.GITHUB_CONTENT_PATH === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["GITHUB_CONTENT_PATH"],
        message:
          "is required when CONTENT_PROVIDER=github (use an empty string for repo root)",
      });
    }
  }

  // /save always writes to GitHub directly, regardless of CONTENT_PROVIDER
  // (which only governs reads) — so these are required whenever any editor
  // is configured, even in local dev.
  if (value.EDITORS.length > 0) {
    for (const key of ["GITHUB_OWNER", "GITHUB_REPOSITORY"] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "is required when EDITORS is set",
        });
      }
    }
    if (!value.GITHUB_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["GITHUB_TOKEN"],
        message: "is required (with write permission) when EDITORS is set",
      });
    }
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}

let cachedEnv: AppEnv | undefined;

/** Lazily parses and caches process.env; throws on first invalid access, never before. */
export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}
