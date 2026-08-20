import { describe, expect, it } from "vitest";
import type { Document } from "@/content";
import { chunkDocument } from "./chunk";

function doc(content: string): Document {
  return { path: "ai-mastery/01-intro.md", name: "01-intro.md", content };
}

describe("chunkDocument", () => {
  it("puts text before the first heading into a headingless chunk", () => {
    const chunks = chunkDocument(doc("Intro text.\n\n## 1.1 First\nBody one."));
    expect(chunks[0]).toEqual({
      path: "ai-mastery/01-intro.md",
      heading: null,
      text: "Intro text.",
    });
    expect(chunks[1]).toEqual({
      path: "ai-mastery/01-intro.md",
      heading: "1.1 First",
      text: "Body one.",
    });
  });

  it("groups everything under its nearest preceding heading, any level", () => {
    const chunks = chunkDocument(
      doc("# Title\nintro\n\n## 1.1 A\na body\n\n### 1.1.1 B\nb body"),
    );
    expect(chunks.map((c) => c.heading)).toEqual(["Title", "1.1 A", "1.1.1 B"]);
  });

  it("drops sections that are empty after trimming", () => {
    const chunks = chunkDocument(doc("## Empty\n\n## 1.1 Real\nSome content."));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe("1.1 Real");
  });

  it("splits a long section into multiple overlapping pieces", () => {
    const paragraph = "word ".repeat(50).trim();
    const longBody = Array.from({ length: 20 }, () => paragraph).join("\n\n");
    const chunks = chunkDocument(doc(`## 1.1 Long\n${longBody}`));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.heading).toBe("1.1 Long");
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it("returns nothing for a blank document", () => {
    expect(chunkDocument(doc("   \n\n  "))).toEqual([]);
  });
});
