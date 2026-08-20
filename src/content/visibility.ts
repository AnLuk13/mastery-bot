export interface PrivateFolderConfig {
  /** A single top-level folder name (see paths.ts) restricted to one owner. */
  folder: string;
  ownerId: number;
}

/**
 * Whether `canonicalPath` should be shown to `userId`. Root ("") is always
 * visible — restriction applies only to a path's top-level segment, so
 * everything under a private folder inherits its owner. Enforced at the
 * Telegram handler boundary (navigation, document view, search, /ask
 * retrieval) rather than inside ContentProvider itself: the provider stays a
 * complete, user-agnostic view of the repository: only what's shown to a
 * specific requester is scoped.
 */
export function isPathVisible(
  canonicalPath: string,
  userId: number | undefined,
  privateFolders: readonly PrivateFolderConfig[],
): boolean {
  if (canonicalPath === "") return true;
  const topSegment = canonicalPath.split("/")[0];
  const restriction = privateFolders.find((p) => p.folder === topSegment);
  return !restriction || userId === restriction.ownerId;
}
