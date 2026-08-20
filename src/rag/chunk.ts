import type { Document } from "@/content";
import type { Chunk } from "./types";

const MAX_CHUNK_LENGTH = 1200;
const OVERLAP_LENGTH = 150;

interface Section {
  heading: string | null;
  body: string;
}

/** Splits a document on Markdown headings (any level); text before the first heading has no heading. */
function splitIntoSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    const body = currentLines.join("\n").trim();
    if (body !== "") sections.push({ heading: currentHeading, body });
    currentLines = [];
  };

  for (const line of lines) {
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}

/** Splits long text into overlapping windows, breaking on paragraph/sentence boundaries where possible. */
function splitLongBody(body: string): string[] {
  if (body.length <= MAX_CHUNK_LENGTH) return [body];

  const pieces: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + MAX_CHUNK_LENGTH, body.length);
    if (end < body.length) {
      const breakPoint = body.lastIndexOf("\n\n", end);
      if (breakPoint > start + OVERLAP_LENGTH) end = breakPoint;
    }
    pieces.push(body.slice(start, end).trim());
    if (end >= body.length) break;
    start = Math.max(end - OVERLAP_LENGTH, start + 1);
  }
  return pieces.filter((piece) => piece !== "");
}

/** Breaks a document into retrievable chunks, one per heading section (further split if long). */
export function chunkDocument(document: Document): Chunk[] {
  const sections = splitIntoSections(document.content);
  const chunks: Chunk[] = [];

  for (const section of sections) {
    for (const piece of splitLongBody(section.body)) {
      chunks.push({
        path: document.path,
        heading: section.heading,
        text: piece,
      });
    }
  }

  return chunks;
}
