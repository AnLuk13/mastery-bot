/**
 * All paths in this module are canonical, POSIX-style, content-root-relative
 * paths with no leading/trailing slash (e.g. "networking-mastery/03-x.md").
 * The empty string "" denotes the content root. Node filesystem/OS path
 * types never leak past a ContentProvider implementation.
 */

export interface DirectoryEntry {
  type: "directory";
  name: string;
  path: string;
}

export interface DocumentEntry {
  type: "document";
  name: string;
  path: string;
}

export type ContentEntry = DirectoryEntry | DocumentEntry;

export interface Document {
  path: string;
  name: string;
  content: string;
}

export type SearchMatchType = "filename" | "path" | "content";

export interface SearchResult {
  path: string;
  name: string;
  matchType: SearchMatchType;
  snippet?: string;
}

export interface ContentProvider {
  listDirectory(path: string): Promise<ContentEntry[]>;
  getDocument(path: string): Promise<Document>;
  search(query: string): Promise<SearchResult[]>;
}
