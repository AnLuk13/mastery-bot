import { describe, expect, it } from "vitest";
import type { ContentEntry } from "@/content";
import {
  createFakeBotContext,
  createFakeContentProvider,
} from "../testHelpers";
import { createStartHandler } from "./start";

const rootEntries: ContentEntry[] = [
  { type: "directory", name: "dotnet-mastery", path: "dotnet-mastery" },
  { type: "directory", name: "networking-mastery", path: "networking-mastery" },
];

describe("createStartHandler", () => {
  it("renders the dynamically discovered root menu", async () => {
    let requestedPath: string | undefined;
    const provider = createFakeContentProvider({
      listDirectory: async (path) => {
        requestedPath = path;
        return rootEntries;
      },
    });
    const { ctx, updateMessageCalls } = createFakeBotContext({ userId: 1 });

    await createStartHandler(provider)(ctx);

    expect(requestedPath).toBe("");
    expect(updateMessageCalls[0].text).toBe("📚 Mastery");
    const rows = updateMessageCalls[0].keyboard?.inline_keyboard ?? [];
    expect(rows[0][0]).toEqual({
      text: "📁 dotnet-mastery",
      callback_data: "d:dotnet-mastery",
    });
    expect(rows[1][0]).toEqual({
      text: "📁 networking-mastery",
      callback_data: "d:networking-mastery",
    });
  });
});
