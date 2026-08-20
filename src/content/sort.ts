import type { ContentEntry } from "./types";

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Directories before files, then natural alphanumeric order within each group. */
export function compareContentEntries(
  a: ContentEntry,
  b: ContentEntry,
): number {
  if (a.type !== b.type) {
    return a.type === "directory" ? -1 : 1;
  }
  return naturalCompare(a.name, b.name);
}
