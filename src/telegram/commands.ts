/**
 * The bot's command list, as registered with Telegram via setMyCommands
 * (see setupHandler.ts) so they show up in the client's "/" autocomplete menu.
 * Keep this in sync with the commands actually wired in bot.ts.
 */
export const BOT_COMMANDS = [
  { command: "start", description: "Show the menu" },
  { command: "search", description: "Search your notes" },
  {
    command: "clear",
    description: "Clear recent messages, keep only the menu",
  },
  {
    command: "save",
    description: "Save a note, or upload a .txt/.md file",
  },
  {
    command: "admin",
    description: "Manage allowed users (admin only)",
  },
] as const;
