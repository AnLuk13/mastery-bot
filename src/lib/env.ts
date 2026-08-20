import { z } from "zod";

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
