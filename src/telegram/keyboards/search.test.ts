import { describe, expect, it } from "vitest";
import type { SearchResult } from "@/content";
import { buildSearchResultsKeyboard } from "./search";

const results: SearchResult[] = [
  {
    path: "networking-mastery/01-tcp.md",
    name: "01-tcp.md",
    matchType: "filename",
  },
  {
    path: "networking-mastery/protocols/deep.md",
    name: "deep.md",
    matchType: "content",
    snippet: "…TCP…",
  },
];

describe("buildSearchResultsKeyboard", () => {
  it("renders one row per result with a readable label and a document callback", () => {
    const keyboard = buildSearchResultsKeyboard(results);
    expect(keyboard.inline_keyboard).toEqual([
      [
        {
          text: "📄 networking-mastery / 01-tcp.md",
          callback_data: "f:networking-mastery/01-tcp.md",
        },
      ],
      [
        {
          text: "📄 networking-mastery / protocols / deep.md",
          callback_data: "f:networking-mastery/protocols/deep.md",
        },
      ],
    ]);
  });

  it("renders no buttons for an empty result set", () => {
    const rows = buildSearchResultsKeyboard([]).inline_keyboard;
    expect(rows.flat()).toEqual([]);
  });
});
