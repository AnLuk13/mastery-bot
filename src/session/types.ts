/**
 * A chat's ambient conversation memory — the running /ask transcript and the
 * last document the user opened via browsing. Persisted server-side (unlike
 * the rest of this app, which is stateless) so a plain follow-up message
 * continues the conversation with no need to reply to a specific prior
 * message. Lives until /clear.
 */
export interface Session {
  transcript: string;
  documentPath?: string;
  /**
   * The full text of a /save request currently awaiting a clarifying
   * answer — set when decideSave() asks a question, read back when the
   * user replies. Exists specifically so a large uploaded file's content
   * survives the round-trip uncapped: the clarify prompt message ALSO
   * echoes a truncated copy (see SAVE_CONTEXT_MARKER in userMessages.ts)
   * as a fallback for when session storage isn't configured, but that
   * echo is capped well under Telegram's message limit and this isn't.
   */
  pendingSaveRequest?: string;
}

export const EMPTY_SESSION: Session = { transcript: "" };

export interface SessionStore {
  get(userId: number): Promise<Session>;
  set(userId: number, session: Session): Promise<void>;
  clear(userId: number): Promise<void>;
}
