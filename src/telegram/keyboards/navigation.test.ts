import { describe, expect, it } from "vitest";
import type { ContentEntry } from "@/content";
import { buildDirectoryKeyboard, buildDocumentKeyboard } from "./navigation";

const entries: ContentEntry[] = [
  {
    type: "directory",
    name: "protocols",
    path: "networking-mastery/protocols",
  },
  { type: "document", name: "01-tcp.md", path: "networking-mastery/01-tcp.md" },
];

describe("buildDirectoryKeyboard", () => {
  it("renders one row per entry plus a Search row at the root", () => {
    const keyboard = buildDirectoryKeyboard(entries, "");
    const rows = keyboard.inline_keyboard;

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([
      { text: "📁 protocols", callback_data: "d:networking-mastery/protocols" },
    ]);
    expect(rows[1]).toEqual([
      { text: "📄 01-tcp.md", callback_data: "f:networking-mastery/01-tcp.md" },
    ]);
    expect(rows[2]).toEqual([{ text: "🔎 Search", callback_data: "s" }]);
  });

  it("renders Back/Home instead of Search for a non-root directory", () => {
    const keyboard = buildDirectoryKeyboard(entries, "networking-mastery");
    const rows = keyboard.inline_keyboard;

    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual([
      { text: "⬅️ Back", callback_data: "d:" },
      { text: "🏠 Home", callback_data: "d:" },
    ]);
  });

  it("computes Back as the parent of a deeply nested directory", () => {
    const keyboard = buildDirectoryKeyboard(
      [],
      "networking-mastery/protocols/transport",
    );
    const backButton = keyboard.inline_keyboard[0][0];
    expect(backButton).toEqual({
      text: "⬅️ Back",
      callback_data: "d:networking-mastery/protocols",
    });
  });

  it("renders no entry rows for an empty directory", () => {
    const keyboard = buildDirectoryKeyboard([], "");
    expect(keyboard.inline_keyboard).toHaveLength(1);
    expect(keyboard.inline_keyboard[0]).toEqual([
      { text: "🔎 Search", callback_data: "s" },
    ]);
  });
});

describe("buildDocumentKeyboard", () => {
  it("computes Back as the containing directory and Home as root", () => {
    const keyboard = buildDocumentKeyboard("networking-mastery/01-tcp.md");
    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: "⬅️ Back", callback_data: "d:networking-mastery" },
        { text: "🏠 Home", callback_data: "d:" },
      ],
    ]);
  });

  it("computes Back as root for a root-level document", () => {
    const keyboard = buildDocumentKeyboard("00-index.md");
    expect(keyboard.inline_keyboard[0][0]).toEqual({
      text: "⬅️ Back",
      callback_data: "d:",
    });
  });

  it("carries a cleanup hint on both Back and Home when the document overflowed into multiple messages", () => {
    const keyboard = buildDocumentKeyboard("networking-mastery/01-tcp.md", {
      firstMessageId: 42,
      count: 2,
    });
    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: "⬅️ Back", callback_data: "d:networking-mastery%42+2" },
        { text: "🏠 Home", callback_data: "d:%42+2" },
      ],
    ]);
  });

  it("omits the cleanup hint when the document fit in a single message", () => {
    const keyboard = buildDocumentKeyboard("networking-mastery/01-tcp.md");
    expect(keyboard.inline_keyboard[0]).toEqual([
      { text: "⬅️ Back", callback_data: "d:networking-mastery" },
      { text: "🏠 Home", callback_data: "d:" },
    ]);
  });
});
