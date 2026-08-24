import { describe, expect, it } from "vitest";
import { NullAllowedUsersStore } from "./NullAllowedUsersStore";

describe("NullAllowedUsersStore", () => {
  it("lists as empty", async () => {
    expect(await new NullAllowedUsersStore().list()).toEqual([]);
  });

  it("throws on add, naming the missing KV config", async () => {
    await expect(new NullAllowedUsersStore().add(123)).rejects.toThrow(
      /KV_REST_API_URL/,
    );
  });

  it("throws on remove, naming the missing KV config", async () => {
    await expect(new NullAllowedUsersStore().remove(123)).rejects.toThrow(
      /KV_REST_API_URL/,
    );
  });
});
