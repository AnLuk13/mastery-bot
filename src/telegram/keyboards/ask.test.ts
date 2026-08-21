import { describe, expect, it } from "vitest";
import { buildAskResultKeyboard } from "./ask";

describe("buildAskResultKeyboard", () => {
  it("renders one row per source plus a trailing Home row", () => {
    const keyboard = buildAskResultKeyboard(
      ["ai-mastery/05-embeddings.md", "networking-mastery/08-http.md"],
      false,
    );
    expect(keyboard.inline_keyboard).toEqual([
      [
        {
          text: "📄 05-embeddings.md",
          callback_data: "f:ai-mastery/05-embeddings.md",
        },
      ],
      [
        {
          text: "📄 08-http.md",
          callback_data: "f:networking-mastery/08-http.md",
        },
      ],
      [{ text: "🏠 Home", callback_data: "d:" }],
    ]);
  });

  it("caps source rows at 4 and still appends Home", () => {
    const sources = Array.from({ length: 6 }, (_, i) => `doc-${i}.md`);
    const keyboard = buildAskResultKeyboard(sources, false);
    expect(keyboard.inline_keyboard).toHaveLength(5);
    expect(keyboard.inline_keyboard[4]).toEqual([
      { text: "🏠 Home", callback_data: "d:" },
    ]);
  });

  it("renders just Home when there are no sources", () => {
    const keyboard = buildAskResultKeyboard([], false);
    expect(keyboard.inline_keyboard).toEqual([
      [{ text: "🏠 Home", callback_data: "d:" }],
    ]);
  });

  it("adds a Groq-limits row before Home when rate-limit info is provided", () => {
    const keyboard = buildAskResultKeyboard([], false, {
      remainingRequests: 998,
      limitRequests: 1000,
      remainingTokens: 7908,
      limitTokens: 8000,
    });
    expect(keyboard.inline_keyboard).toEqual([
      [{ text: "📊 Groq limits", callback_data: "l:998-1000-7908-8000" }],
      [{ text: "🏠 Home", callback_data: "d:" }],
    ]);
  });

  it("adds a Save row before the Groq-limits and Home rows when the asker is an editor", () => {
    const keyboard = buildAskResultKeyboard([], true, {
      remainingRequests: 998,
      limitRequests: 1000,
      remainingTokens: 7908,
      limitTokens: 8000,
    });
    expect(keyboard.inline_keyboard).toEqual([
      [{ text: "💾 Save this", callback_data: "a" }],
      [{ text: "📊 Groq limits", callback_data: "l:998-1000-7908-8000" }],
      [{ text: "🏠 Home", callback_data: "d:" }],
    ]);
  });

  it("omits the Save row when the asker isn't an editor", () => {
    const keyboard = buildAskResultKeyboard([], false);
    expect(
      keyboard.inline_keyboard
        .flat()
        .some((btn) => btn.text === "💾 Save this"),
    ).toBe(false);
  });
});
