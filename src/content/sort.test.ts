import { describe, expect, it } from "vitest";
import { compareContentEntries, naturalCompare } from "./sort";
import type { ContentEntry } from "./types";

describe("naturalCompare", () => {
  it("orders numeric prefixes naturally, not lexicographically", () => {
    const names = ["10-beta.md", "01-alpha.md", "02-gamma.md", "00-INDEX.md"];
    expect([...names].sort(naturalCompare)).toEqual([
      "00-INDEX.md",
      "01-alpha.md",
      "02-gamma.md",
      "10-beta.md",
    ]);
  });

  it("places a non-numbered file like GLOSSARY.md after numbered files", () => {
    const names = ["01-alpha.md", "GLOSSARY.md", "00-INDEX.md"];
    expect([...names].sort(naturalCompare)).toEqual([
      "00-INDEX.md",
      "01-alpha.md",
      "GLOSSARY.md",
    ]);
  });
});

describe("compareContentEntries", () => {
  const dir = (name: string): ContentEntry => ({
    type: "directory",
    name,
    path: name,
  });
  const doc = (name: string): ContentEntry => ({
    type: "document",
    name,
    path: name,
  });

  it("places directories before files regardless of name", () => {
    const entries = [doc("00-INDEX.md"), dir("zzz-folder"), doc("01-alpha.md")];
    const sorted = [...entries].sort(compareContentEntries);
    expect(sorted.map((e) => e.name)).toEqual([
      "zzz-folder",
      "00-INDEX.md",
      "01-alpha.md",
    ]);
  });

  it("naturally sorts within each group", () => {
    const entries = [
      dir("10-later"),
      dir("02-earlier"),
      doc("10-later.md"),
      doc("02-earlier.md"),
    ];
    const sorted = [...entries].sort(compareContentEntries);
    expect(sorted.map((e) => e.name)).toEqual([
      "02-earlier",
      "10-later",
      "02-earlier.md",
      "10-later.md",
    ]);
  });
});
