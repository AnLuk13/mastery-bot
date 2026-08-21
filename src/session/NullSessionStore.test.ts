import { describe, expect, it } from "vitest";
import { NullSessionStore } from "./NullSessionStore";

describe("NullSessionStore", () => {
  it("always returns an empty session and silently no-ops on writes", async () => {
    const store = new NullSessionStore();
    await store.set(1, {
      transcript: "should be discarded",
      documentPath: "a.md",
    });

    expect(await store.get(1)).toEqual({ transcript: "" });
    await expect(store.clear(1)).resolves.toBeUndefined();
  });
});
