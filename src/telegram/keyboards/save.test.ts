import { describe, expect, it } from "vitest";
import { buildSaveResultKeyboard } from "./save";

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
