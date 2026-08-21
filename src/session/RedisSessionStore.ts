import type { Redis } from "@upstash/redis";
import { EMPTY_SESSION, type Session, type SessionStore } from "./types";

const KEY_PREFIX = "mastery-bot:session:";

/** Pick<>, not the concrete class: keeps test fakes from needing a real Redis instance. */
export type RedisLike = Pick<Redis, "get" | "set" | "del">;

export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: RedisLike) {}

  async get(userId: number): Promise<Session> {
    const stored = await this.redis.get<Session>(`${KEY_PREFIX}${userId}`);
    return stored ?? EMPTY_SESSION;
  }

  async set(userId: number, session: Session): Promise<void> {
    await this.redis.set(`${KEY_PREFIX}${userId}`, session);
  }

  async clear(userId: number): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}${userId}`);
  }
}
