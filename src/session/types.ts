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
}

export const EMPTY_SESSION: Session = { transcript: "" };

export interface SessionStore {
  get(userId: number): Promise<Session>;
  set(userId: number, session: Session): Promise<void>;
  clear(userId: number): Promise<void>;
}
