export class ContentNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Content not found: ${path}`);
    this.name = "ContentNotFoundError";
  }
}

export class InvalidPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPathError";
  }
}

/** Provider-agnostic infrastructure errors: any ContentProvider may throw these. */

export class ContentProviderAuthError extends Error {
  constructor(message = "Authentication with the content provider failed") {
    super(message);
    this.name = "ContentProviderAuthError";
  }
}

export class ContentProviderPermissionError extends Error {
  constructor(message = "Access to the requested content was denied") {
    super(message);
    this.name = "ContentProviderPermissionError";
  }
}

export class ContentProviderRateLimitedError extends Error {
  constructor(
    public readonly retryAfterSeconds?: number,
    message = "The content provider is rate-limiting requests",
  ) {
    super(message);
    this.name = "ContentProviderRateLimitedError";
  }
}

export class ContentProviderUnavailableError extends Error {
  constructor(message = "The content provider is temporarily unavailable") {
    super(message);
    this.name = "ContentProviderUnavailableError";
  }
}

/** A write was rejected because the file changed since the caller last read its sha (GitHub 409). */
export class ContentWriteConflictError extends Error {
  constructor(message = "The file changed since it was last read") {
    super(message);
    this.name = "ContentWriteConflictError";
  }
}
