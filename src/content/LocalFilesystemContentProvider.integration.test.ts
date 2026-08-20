import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalFilesystemContentProvider } from "./LocalFilesystemContentProvider";

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

    it("lists the real content root", async () => {
      const entries = await provider.listDirectory("");
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(["directory", "document"]).toContain(entry.type);
      }
    });

    it("navigates into a discovered top-level folder and finds documents", async () => {
      const root = await provider.listDirectory("");
      const folder = root.find((entry) => entry.type === "directory");
      expect(folder).toBeDefined();
      if (!folder) return;

      const children = await provider.listDirectory(folder.path);
      expect(children.some((entry) => entry.type === "document")).toBe(true);
    });

    it("reads a discovered document end-to-end", async () => {
      const root = await provider.listDirectory("");
      const folder = root.find((entry) => entry.type === "directory");
      if (!folder) return;

      const children = await provider.listDirectory(folder.path);
      const document = children.find((entry) => entry.type === "document");
      expect(document).toBeDefined();
      if (!document) return;

      const opened = await provider.getDocument(document.path);
      expect(opened.content.length).toBeGreaterThan(0);
      expect(opened.path).toBe(document.path);
    });
  },
);
