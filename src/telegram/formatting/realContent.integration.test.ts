import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalFilesystemContentProvider } from "@/content";
import { renderDocumentMessages } from "./index";

/**
 * Sanity check: every real document in the actual mastery knowledge base
 * renders without throwing and produces messages within Telegram's limit.
 * Skips (doesn't fail) when the folder isn't present, same as the content
 * provider's own integration tests.
 */
const REAL_CONTENT_ROOT =
  process.env.MASTERY_CONTENT_ROOT ?? "C:\\Users\\antonio\\Desktop\\mastery";
const rootExists = existsSync(REAL_CONTENT_ROOT);

describe.skipIf(!rootExists)(
  "renderDocumentMessages (integration: real mastery content)",
  () => {
    const provider = new LocalFilesystemContentProvider(REAL_CONTENT_ROOT);

    async function collectMarkdownPaths(dirPath: string): Promise<string[]> {
      const entries = await provider.listDirectory(dirPath);
      const paths: string[] = [];
      for (const entry of entries) {
        if (entry.type === "document") paths.push(entry.path);
        else paths.push(...(await collectMarkdownPaths(entry.path)));
      }
      return paths;
    }

    it("renders every real document without throwing and within Telegram's message limit", async () => {
      const paths = await collectMarkdownPaths("");
      expect(paths.length).toBeGreaterThan(0);

      for (const path of paths) {
        const document = await provider.getDocument(path);
        const messages = renderDocumentMessages(document);

        expect(messages.length).toBeGreaterThan(0);
        for (const message of messages) {
          expect(message.text.length).toBeLessThanOrEqual(4096);
          expect(message.parseMode).toBe("HTML");
        }
      }
    });
  },
);
