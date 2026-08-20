import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string equality, safe for comparing secrets against
 * attacker-controlled input (a header value). Hashing first sidesteps
 * timingSafeEqual's requirement that both buffers have equal length —
 * unequal-length secrets would otherwise throw (or, if handled by
 * shortcutting on length first, leak the correct length via timing).
 */
export function secureCompare(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
