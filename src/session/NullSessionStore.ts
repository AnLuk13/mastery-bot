import { EMPTY_SESSION, type Session, type SessionStore } from "./types";

/**
 * No-op store used when Redis isn't configured — ambient memory is simply
 * off (every /ask starts fresh, no document carries forward) while
 * everything else in the app still works unmodified.
 */
export class NullSessionStore implements SessionStore {
  async get(_userId: number): Promise<Session> {
    return EMPTY_SESSION;
  }

  async set(_userId: number, _session: Session): Promise<void> {}

  async clear(_userId: number): Promise<void> {}
}
