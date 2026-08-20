import { describe, expect, it } from "vitest";
import { isPathVisible } from "./visibility";

const privateFolders = [
  { folder: "antonio", ownerId: 712059530 },
  { folder: "andreea", ownerId: 744020052 },
];

describe("isPathVisible", () => {
  it("is always visible when no restriction matches", () => {
    expect(isPathVisible("networking-mastery/dns.md", 999, [])).toBe(true);
    expect(isPathVisible("networking-mastery/dns.md", undefined, [])).toBe(
      true,
    );
  });

  it("is visible to the owner of a restricted top-level folder", () => {
    expect(
      isPathVisible(
        "antonio/networking-mastery/dns.md",
        712059530,
        privateFolders,
      ),
    ).toBe(true);
  });

  it("is hidden from anyone else, including an unauthenticated caller", () => {
    expect(
      isPathVisible(
        "antonio/networking-mastery/dns.md",
        744020052,
        privateFolders,
      ),
    ).toBe(false);
    expect(
      isPathVisible(
        "antonio/networking-mastery/dns.md",
        undefined,
        privateFolders,
      ),
    ).toBe(false);
  });

  it("only restricts by the path's top-level segment, not a substring match", () => {
    expect(isPathVisible("antonio-notes/file.md", 999, privateFolders)).toBe(
      true,
    );
  });

  it("the root path is always visible regardless of restrictions", () => {
    expect(isPathVisible("", 999, privateFolders)).toBe(true);
  });

  it("each restricted folder is scoped to its own owner independently", () => {
    expect(isPathVisible("andreea/notes.md", 744020052, privateFolders)).toBe(
      true,
    );
    expect(isPathVisible("andreea/notes.md", 712059530, privateFolders)).toBe(
      false,
    );
  });
});
