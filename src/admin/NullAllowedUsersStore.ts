import type { AllowedUsersStore } from "./types";

/**
 * Used when KV isn't configured — dynamic user management is off. list()
 * returns empty rather than throwing so the auth-check merge in bot.ts stays
 * unconditional; add()/remove() throw so /admin can report clearly instead
 * of silently pretending to work.
 */
export class NullAllowedUsersStore implements AllowedUsersStore {
  async list(): Promise<number[]> {
    return [];
  }

  async add(_userId: number): Promise<void> {
    throw new Error(
      "Dynamic user management requires KV_REST_API_URL/KV_REST_API_TOKEN to be configured",
    );
  }

  async remove(_userId: number): Promise<void> {
    throw new Error(
      "Dynamic user management requires KV_REST_API_URL/KV_REST_API_TOKEN to be configured",
    );
  }
}
