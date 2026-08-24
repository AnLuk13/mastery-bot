/**
 * The bot-wide set of extra allowed Telegram user ids, added/removed at
 * runtime via /admin — layered on top of the immutable env-configured
 * ALLOWED_TELEGRAM_USER_IDS base list (see enforceAuthorization's caller in
 * bot.ts, which merges the two). Deliberately global, not per-admin: there's
 * one shared allowed-user list, not one per admin.
 */
export interface AllowedUsersStore {
  list(): Promise<number[]>;
  add(userId: number): Promise<void>;
  remove(userId: number): Promise<void>;
}
