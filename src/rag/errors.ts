export class GroqUnavailableError extends Error {
  constructor(message = "The Groq API is temporarily unavailable") {
    super(message);
    this.name = "GroqUnavailableError";
  }
}

export class GroqRateLimitedError extends Error {
  constructor(
    public readonly retryAfterSeconds?: number,
    message = "The Groq API is rate-limiting requests",
  ) {
    super(message);
    this.name = "GroqRateLimitedError";
  }
}
