import { describe, expect, it } from "vitest";
import {
  RedisAllowedUsersStore,
  type RedisLike,
} from "./RedisAllowedUsersStore";

function makeFakeRedis(
  initial: string[] = [],
): RedisLike & { members: string[] } {
  const members = [...initial];
  const fake = {
    members,
    async smembers() {
      return [...members];
    },
    async sadd(_key: string, ...values: string[]) {
      let added = 0;
      for (const value of values) {
        if (!members.includes(value)) {
          members.push(value);
          added++;
        }
      }
      return added;
    },
    async srem(_key: string, ...values: string[]) {
      let removed = 0;
      for (const value of values) {
        const index = members.indexOf(value);
        if (index !== -1) {
          members.splice(index, 1);
          removed++;
        }
      }
      return removed;
    },
  };
  return fake as unknown as RedisLike & { members: string[] };
}

describe("RedisAllowedUsersStore", () => {
  it("lists members as numbers", async () => {
    const redis = makeFakeRedis(["123", "456"]);
    const store = new RedisAllowedUsersStore(redis);
    expect(await store.list()).toEqual([123, 456]);
  });

  it("adds a user id", async () => {
    const redis = makeFakeRedis();
    const store = new RedisAllowedUsersStore(redis);
    await store.add(789);
    expect(await store.list()).toEqual([789]);
  });

  it("removes a user id", async () => {
    const redis = makeFakeRedis(["123", "456"]);
    const store = new RedisAllowedUsersStore(redis);
    await store.remove(123);
    expect(await store.list()).toEqual([456]);
  });

  it("filters out any non-numeric member instead of throwing", async () => {
    const redis = makeFakeRedis(["123", "not-a-number"]);
    const store = new RedisAllowedUsersStore(redis);
    expect(await store.list()).toEqual([123]);
  });
});
