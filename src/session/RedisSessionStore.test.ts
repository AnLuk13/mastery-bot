import { describe, expect, it } from "vitest";
import { RedisSessionStore, type RedisLike } from "./RedisSessionStore";

function makeFakeRedis(): RedisLike & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async get(key: string) {
      return (store.get(key) as never) ?? null;
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
      return "OK" as never;
    },
    async del(...keys: string[]) {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    },
  };
}

describe("RedisSessionStore", () => {
  it("returns an empty session when nothing is stored", async () => {
    const store = new RedisSessionStore(makeFakeRedis());
    expect(await store.get(1)).toEqual({ transcript: "" });
  });

  it("round-trips a session through set/get", async () => {
    const redis = makeFakeRedis();
    const store = new RedisSessionStore(redis);
    await store.set(1, { transcript: "Q: hi\nA: hello", documentPath: "a.md" });

    expect(await store.get(1)).toEqual({
      transcript: "Q: hi\nA: hello",
      documentPath: "a.md",
    });
  });

  it("keeps sessions for different users isolated", async () => {
    const store = new RedisSessionStore(makeFakeRedis());
    await store.set(1, { transcript: "user one" });
    await store.set(2, { transcript: "user two" });

    expect((await store.get(1)).transcript).toBe("user one");
    expect((await store.get(2)).transcript).toBe("user two");
  });

  it("clears a session back to empty", async () => {
    const store = new RedisSessionStore(makeFakeRedis());
    await store.set(1, { transcript: "some context", documentPath: "a.md" });
    await store.clear(1);

    expect(await store.get(1)).toEqual({ transcript: "" });
  });
});
