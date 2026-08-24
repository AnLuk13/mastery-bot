import type { Redis } from "@upstash/redis";
import type { AllowedUsersStore } from "./types";

const KEY = "mastery-bot:allowed-users";

/** Pick<>, not the concrete class: keeps test fakes from needing a real Redis instance. */
export type RedisLike = Pick<Redis, "sadd" | "srem" | "smembers">;

export class RedisAllowedUsersStore implements AllowedUsersStore {
  constructor(private readonly redis: RedisLike) {}

  async list(): Promise<number[]> {
    const members = await this.redis.smembers(KEY);
    return members.map(Number).filter((id) => Number.isSafeInteger(id));
  }

  async add(userId: number): Promise<void> {
    await this.redis.sadd(KEY, String(userId));
  }

  async remove(userId: number): Promise<void> {
    await this.redis.srem(KEY, String(userId));
  }
}
