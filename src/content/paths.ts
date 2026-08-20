import path from "node:path";
import { realpath } from "node:fs/promises";
import { InvalidPathError } from "./errors";

const UNSAFE_SEGMENT_CHARS = /[<>:"|?*\x00-\x1f]/;
const DRIVE_LETTER = /^[a-zA-Z]:/;

/**
 * Normalizes and validates a content-relative path, returning a canonical
 * POSIX-style path ("" for root, otherwise no leading/trailing slash).
 * Throws InvalidPathError for anything that isn't an unambiguous, safe,
 * root-relative path. Percent signs and backslashes are rejected outright
 * rather than decoded/converted, so no traversal sequence can hide behind
 * encoding or mixed separators.
 */
export function normalizeRelativePath(input: string): string {
  if (typeof input !== "string") {
    throw new InvalidPathError("Path must be a string");
  }
  if (input === "") {
    return "";
  }
  if (input.includes("\0")) {
    throw new InvalidPathError("Path contains a null byte");
  }
  if (input.includes("%")) {
    throw new InvalidPathError("Path must not be percent-encoded");
  }
  if (input.includes("\\")) {
    throw new InvalidPathError("Path must use forward slashes only");
  }
  if (input.startsWith("/")) {
    throw new InvalidPathError("Absolute paths are not allowed");
  }
  if (DRIVE_LETTER.test(input)) {
    throw new InvalidPathError("Drive-letter paths are not allowed");
  }
  if (input.endsWith("/")) {
    throw new InvalidPathError("Path must not end with a slash");
  }

  const segments = input.split("/");
  for (const segment of segments) {
    if (segment === "") {
      throw new InvalidPathError("Path contains an empty segment");
    }
    if (segment === "." || segment === "..") {
      throw new InvalidPathError("Path traversal segments are not allowed");
    }
    if (UNSAFE_SEGMENT_CHARS.test(segment)) {
      throw new InvalidPathError(
        `Path segment "${segment}" contains disallowed characters`,
      );
    }
  }

  return segments.join("/");
}

export function joinCanonical(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/** Canonical parent of a canonical path; the parent of root is root. */
export function parentPath(canonicalPath: string): string {
  if (canonicalPath === "") return "";
  const segments = canonicalPath.split("/");
  segments.pop();
  return segments.join("/");
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Resolves a canonical relative path to an absolute filesystem path,
 * confirming it stays within `root` both syntactically and after resolving
 * symlinks (so a symlink/junction planted inside CONTENT_ROOT cannot be used
 * to read outside it). Rejects with InvalidPathError on escape, or lets the
 * underlying ENOENT propagate for the caller to map to a not-found error.
 */
export async function resolveWithinRoot(
  root: string,
  relativePath: string,
): Promise<string> {
  const canonical = normalizeRelativePath(relativePath);
  const segments = canonical === "" ? [] : canonical.split("/");
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);

  if (!isPathWithinRoot(resolvedRoot, target)) {
    throw new InvalidPathError("Resolved path escapes the content root");
  }

  const realRoot = await realpath(root);
  const realTarget = await realpath(target);

  if (!isPathWithinRoot(realRoot, realTarget)) {
    throw new InvalidPathError("Resolved path escapes the content root");
  }

  return realTarget;
}
