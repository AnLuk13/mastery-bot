import { describe, expect, it } from "vitest";
import {
  buildReorganizeConfirmKeyboard,
  buildReorganizeResultKeyboard,
  buildSaveResultKeyboard,
} from "./save";

describe("buildSaveResultKeyboard", () => {
  it("renders View and Revert buttons", () => {
    const keyboard = buildSaveResultKeyboard(
      "antonio/networking/dns.md",
      "abcdef1234567890",
    );
    expect(keyboard.inline_keyboard[0]).toEqual([
      { text: "📄 View", callback_data: "f:antonio/networking/dns.md" },
      {
        text: "↩️ Revert",
        callback_data: "v:antonio/networking/dns.md%abcdef123456",
      },
    ]);
  });

  it("omits Revert (keeps View) when the callback would exceed the size budget", () => {
    const longPath =
      "antonio/" + "a-very-long-folder-name/".repeat(3) + "file.md";
    const keyboard = buildSaveResultKeyboard(longPath, "abcdef1234567890");
    const buttons = keyboard.inline_keyboard.flat();
    expect(buttons.some((b) => b.text === "📄 View")).toBe(true);
    expect(buttons.some((b) => b.text === "↩️ Revert")).toBe(false);
  });
});

describe("buildReorganizeConfirmKeyboard", () => {
  it("renders Yes/No buttons", () => {
    const keyboard = buildReorganizeConfirmKeyboard();
    expect(keyboard.inline_keyboard[0]).toEqual([
      { text: "✅ Yes, reorganize", callback_data: "y" },
      { text: "❌ No, keep separate", callback_data: "n" },
    ]);
  });
});

describe("buildReorganizeResultKeyboard", () => {
  it("renders one row per target, omitting View for a non-viewable (deleted) path", () => {
    const keyboard = buildReorganizeResultKeyboard([
      {
        label: "sales-call.md",
        path: "andreea/meetings/sales-call.md",
        beforeCommitSha: "aaaaaaaaaaaa",
        viewable: true,
      },
      {
        label: "restore meeting.md",
        path: "andreea/meeting.md",
        beforeCommitSha: "bbbbbbbbbbbb",
        viewable: false,
      },
    ]);

    expect(keyboard.inline_keyboard).toEqual([
      [
        {
          text: "📄 sales-call.md",
          callback_data: "f:andreea/meetings/sales-call.md",
        },
        {
          text: "↩️ Undo: sales-call.md",
          callback_data: "v:andreea/meetings/sales-call.md%aaaaaaaaaaaa",
        },
      ],
      [
        {
          text: "↩️ Undo: restore meeting.md",
          callback_data: "v:andreea/meeting.md%bbbbbbbbbbbb",
        },
      ],
    ]);
  });
});
