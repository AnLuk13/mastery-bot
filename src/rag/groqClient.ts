import { z } from "zod";
import { GroqRateLimitedError, GroqUnavailableError } from "./errors";

const GROQ_API_BASE = "https://api.groq.com/openai/v1";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const completionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
});

export interface GroqClientOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

/** Minimal typed client for Groq's OpenAI-compatible chat completions endpoint. */
export class GroqClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GroqClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createChatCompletion(messages: ChatMessage[]): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${GROQ_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2,
          // Keeps answers well under Telegram's 4096-char single-message limit.
          max_tokens: 700,
          // Groq's current default models (openai/gpt-oss-*) spend part of
          // max_tokens on a hidden reasoning pass before the visible answer;
          // without capping its effort, that pass alone can exhaust the
          // budget and leave `content` empty. Ignored by non-reasoning
          // models, so this is safe if GROQ_MODEL is changed.
          reasoning_effort: "low",
        }),
      });
    } catch {
      throw new GroqUnavailableError("Network error while contacting Groq");
    }

    if (!response.ok) {
      await this.throwForStatus(response);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new GroqUnavailableError("Groq returned a malformed response");
    }

    const parsed = completionResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new GroqUnavailableError(
        "Groq returned an unexpected response shape",
      );
    }
    const content = parsed.data.choices[0].message.content.trim();
    if (content === "") {
      // E.g. a reasoning model spent its whole token budget "thinking" and
      // never reached a visible answer. Telegram also rejects empty messages.
      throw new GroqUnavailableError("Groq returned an empty completion");
    }
    return content;
  }

  private async throwForStatus(response: Response): Promise<never> {
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new GroqRateLimitedError(
        retryAfter ? Number(retryAfter) : undefined,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new GroqUnavailableError("Groq rejected the configured API key");
    }
    throw new GroqUnavailableError(
      `Groq returned an unexpected status (${response.status})`,
    );
  }
}
