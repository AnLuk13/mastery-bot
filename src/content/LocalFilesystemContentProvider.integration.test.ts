import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalFilesystemContentProvider } from "./LocalFilesystemContentProvider";
import type { ContentEntry } from "./types";

/**
 * Sanity check against the real mastery knowledge base, if present on this
 * machine. Purely additive to the fixture-based unit tests above; it makes
 * no assumptions about folder/file names or counts, so it stays valid as
 * the real content evolves. Skipped automatically (not failed) when the
 * directory isn't present, e.g. in CI.
 */
const REAL_CONTENT_ROOT =
  process.env.MASTERY_CONTENT_ROOT ?? "C:\\Users\\antonio\\Desktop\\mastery";
const rootExists = existsSync(REAL_CONTENT_ROOT);

describe.skipIf(!rootExists)(
  "LocalFilesystemContentProvider (integration: real mastery content)",
  () => {
    const provider = new LocalFilesystemContentProvider(REAL_CONTENT_ROOT);

    /** Depth-first search for the first document anywhere under `dirPath` — makes no assumption about nesting depth. */
    async function findFirstDocument(
      dirPath: string,
    ): Promise<ContentEntry | undefined> {
      const entries = await provider.listDirectory(dirPath);
      const document = entries.find((entry) => entry.type === "document");
      if (document) return document;
      for (const entry of entries) {
        if (entry.type !== "directory") continue;
        const found = await findFirstDocument(entry.path);
        if (found) return found;
      }
      return undefined;
    }

    it("lists the real content root", async () => {
      const entries = await provider.listDirectory("");
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(["directory", "document"]).toContain(entry.type);
      }
    });

    it("navigates into a discovered folder and finds documents somewhere within it", async () => {
      const document = await findFirstDocument("");
      expect(document).toBeDefined();
    });

    it("reads a discovered document end-to-end", async () => {
      const document = await findFirstDocument("");
      expect(document).toBeDefined();
      if (!document) return;

      const opened = await provider.getDocument(document.path);
      expect(opened.content.length).toBeGreaterThan(0);
      expect(opened.path).toBe(document.path);
    });
  },
);
